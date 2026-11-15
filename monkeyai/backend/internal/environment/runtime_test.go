package environment

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type runtimeAuthorizer struct {
	calls, revoke int
	requestID     string
	check         func(context.Context, pgx.Tx) error
}

func (a *runtimeAuthorizer) ApproveRuntime(context.Context, pgx.Tx, string, string, []byte, string) (string, error) {
	a.calls++
	return a.requestID, nil
}
func (a *runtimeAuthorizer) CheckRuntime(ctx context.Context, tx pgx.Tx, _ string, _ string, _ []byte) error {
	if a.check != nil {
		return a.check(ctx, tx)
	}
	return nil
}
func (a *runtimeAuthorizer) RevokeRuntime(context.Context, pgx.Tx, string, string) ([]string, error) {
	a.revoke++
	return nil, nil
}
func (a *runtimeAuthorizer) NotifyGrantRevoked(string) {}
func managedEnvironment(t *testing.T) (*Service, Result, string, *runtimeAuthorizer) {
	t.Helper()
	s, user, host := fixture(t)
	if _, err := s.pool.Exec(t.Context(), `UPDATE hosts SET report=report || '{"prerequisites_met":true,"network_policies":["isolated","public-only"],"runtime_protocol":1}' WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	auth := &runtimeAuthorizer{requestID: resource.ID()}
	s.WithRuntime("https://ai.example.com", resource.ID(), auth)
	created, err := s.Create(t.Context(), user, Creation{"项目", "runtime-test"})
	if err != nil {
		t.Fatal(err)
	}
	return s, created, host, auth
}
func runtimeRequest(e View) RuntimeRequest {
	return RuntimeRequest{EnvironmentID: e.ID, InstanceID: e.InstanceID, Generation: e.Generation, MachineID: resource.ID(), PublicKey: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), UserCode: "ABCD-EFGH"}
}
func TestRuntimeBindingAndLifecycleGate(t *testing.T) {
	s, created, host, auth := managedEnvironment(t)
	ctx := t.Context()
	e := created.Environment
	in := runtimeRequest(e)
	if err := s.approveRuntime(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	in.UserCode = ""
	if err := s.approveRuntime(ctx, host, in); err != nil || auth.calls != 1 {
		t.Fatalf("重试重新批准：%v", err)
	}
	if allowed, err := s.RuntimeAllowed(ctx, nil, e.UserID, in.MachineID); err != nil || !allowed {
		t.Fatal("当前实例无法访问", err)
	}
	other := in
	other.MachineID = resource.ID()
	if err := s.approveRuntime(ctx, host, other); err == nil {
		t.Fatal("替换了稳定身份")
	}
	if err := s.approveRuntime(ctx, resource.ID(), in); err == nil {
		t.Fatal("跨宿主批准")
	}
	syncState(t, s, host, observe(e, "running"))
	stop, err := s.Change(ctx, &e.UserID, e.ID, "stopped", Change{e.Generation, "stop"})
	if err != nil {
		t.Fatal(err)
	}
	if allowed, err := s.RuntimeAllowed(ctx, nil, e.UserID, in.MachineID); err != nil || allowed {
		t.Fatal("停止后仍允许访问", err)
	}
	if err := s.approveRuntime(ctx, host, in); err == nil {
		t.Fatal("停止后批准迟到申请")
	}
	syncState(t, s, host, observe(stop.Environment, "stopped"))
	start, err := s.Change(ctx, &e.UserID, e.ID, "running", Change{stop.Environment.Generation, "start"})
	if err != nil {
		t.Fatal(err)
	}
	if allowed, _ := s.RuntimeAllowed(ctx, nil, e.UserID, in.MachineID); allowed {
		t.Fatal("新实例尚未核对身份却恢复访问")
	}
	in.Generation = start.Environment.Generation
	in.InstanceID = start.Environment.InstanceID
	if err := s.approveRuntime(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	if allowed, _ := s.RuntimeAllowed(ctx, nil, e.UserID, in.MachineID); !allowed {
		t.Fatal("同身份新实例无法恢复")
	}
	if _, err := s.Change(ctx, &e.UserID, e.ID, "deleted", Change{in.Generation, "delete"}); err != nil || auth.revoke != 1 {
		t.Fatal("删除未撤销授权", err)
	}
}
func TestRuntimeCannotBindWithoutDeviceRequest(t *testing.T) {
	s, created, host, _ := managedEnvironment(t)
	in := runtimeRequest(created.Environment)
	in.UserCode = ""
	if err := s.approveRuntime(t.Context(), host, in); err == nil {
		t.Fatal("首次绑定未核验设备申请")
	}
	if runtime, err := sqlc.New(s.pool).GetRuntime(t.Context(), created.Environment.ID); err != nil || runtime.MachineID != nil {
		t.Fatal("失败后留下绑定", err)
	}
}
func TestOldEngineCannotReceiveManagedEnvironment(t *testing.T) {
	s, created, host, _ := managedEnvironment(t)
	if _, err := s.pool.Exec(t.Context(), `UPDATE hosts SET report=report-'runtime_protocol' WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(t.Context(), created.Environment.UserID, Creation{"旧宿主", "new"}); err == nil {
		t.Fatal("向旧 engine 调度托管运行时")
	}
}

type readiness struct{ ready bool }

func (r *readiness) RuntimeReady(context.Context, string, string) (bool, error) { return r.ready, nil }
func TestRuntimeOperationWaitsForRelayAndCurrentObservation(t *testing.T) {
	s, created, host, _ := managedEnvironment(t)
	ctx := t.Context()
	e := created.Environment
	ready := &readiness{}
	s.WithReadiness(ready)
	in := runtimeRequest(e)
	if err := s.approveRuntime(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e, "running"))
	q := sqlc.New(s.pool)
	op, err := q.RuntimeOperation(ctx, sqlc.RuntimeOperationParams{EnvironmentID: e.ID, Generation: e.Generation})
	if err != nil || op.Status != "pending" {
		t.Fatal("中转未就绪就完成了创建操作", err)
	}
	row, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: e.ID})
	if err != nil {
		t.Fatal(err)
	}
	view, err := s.environmentView(ctx, row)
	if err != nil || view.Connectable || view.MachineID == nil {
		t.Fatal("错误的未连接状态", err)
	}
	ready.ready = true
	syncState(t, s, host, observe(e, "running"))
	op, err = q.RuntimeOperation(ctx, sqlc.RuntimeOperationParams{EnvironmentID: e.ID, Generation: e.Generation})
	if err != nil || op.Status != "succeeded" {
		t.Fatal("中转就绪后未完成创建", err)
	}
	view, err = s.environmentView(ctx, row)
	if err != nil || !view.Connectable {
		t.Fatal("缺少可连接状态", err)
	}
	row.ObservedGeneration--
	view, err = s.environmentView(ctx, row)
	if err != nil || view.Connectable {
		t.Fatal("过期观察仍可连接", err)
	}
}
