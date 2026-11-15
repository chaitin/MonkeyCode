package standalone

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type runner struct {
	status         Status
	logins, serves int
	observe        bool
	serveErr       error
}

func (r *runner) Status(context.Context, lifecycle.Spec) (Status, error) { return r.status, nil }
func (r *runner) Login(_ context.Context, s lifecycle.Spec, authorize func(string) error) error {
	r.logins++
	r.status.MachineID = "12345678-1234-4234-9234-123456789abc"
	r.status.PublicKey = base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	if err := authorize("ABCD-EFGH"); err != nil {
		return err
	}
	r.status.Authorized = true
	r.status.Account = &Account{Server: s.Runtime.Server, ServerID: s.Runtime.ServerID, UserID: s.Runtime.UserID}
	return nil
}
func (r *runner) Serve(_ context.Context, _ lifecycle.Spec, observe bool) error {
	r.serves++
	r.observe = observe
	return r.serveErr
}
func managed(t *testing.T) lifecycle.Spec {
	raw, err := os.ReadFile("../../examples/environment.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := lifecycle.Decode(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	s.NetworkPolicy = "public-only"
	s.Runtime = &lifecycle.Runtime{Server: "https://ai.example.com", ServerID: "server-a", UserID: "user-a"}
	return s
}
func TestLoginAndPersistentIdentity(t *testing.T) {
	s := managed(t)
	r := &runner{}
	var requests []Request
	approve := func(_ context.Context, in Request) error { requests = append(requests, in); return nil }
	if err := Ensure(t.Context(), s, r, approve, false); err != nil {
		t.Fatal(err)
	}
	if r.logins != 1 || r.serves != 1 || len(requests) != 2 || requests[0].UserCode != "ABCD-EFGH" || requests[1].UserCode != "" || requests[0].MachineID != requests[1].MachineID {
		t.Fatal("登录和身份关联顺序错误")
	}
	if requests[0].InstanceID != s.InstanceID || requests[0].EnvironmentID != s.EnvironmentID || requests[0].Generation != s.Generation {
		t.Fatal("授权缺少实例边界")
	}
	requests = nil
	if err := Ensure(t.Context(), s, r, approve, true); err != nil {
		t.Fatal(err)
	}
	if r.logins != 1 || !r.observe || len(requests) != 1 || requests[0].UserCode != "" {
		t.Fatal("观察流程重新申请了授权")
	}
}
func TestDeniedApprovalNeverStartsRuntime(t *testing.T) {
	r := &runner{}
	err := Ensure(t.Context(), managed(t), r, func(context.Context, Request) error { return errors.New("已撤销") }, false)
	if err == nil || r.serves != 0 {
		t.Fatal("授权失败后启动了运行时")
	}
}
func TestObservationDoesNotLoginOrRestart(t *testing.T) {
	r := &runner{}
	if err := Ensure(t.Context(), managed(t), r, func(context.Context, Request) error { return nil }, true); err == nil || r.logins != 0 || r.serves != 0 {
		t.Fatal("丢失授权后自动登录")
	}
	r.serveErr = errors.New("进程已退出")
	if err := Ensure(t.Context(), managed(t), r, func(context.Context, Request) error { return nil }, false); err == nil {
		t.Fatal("吞掉执行失败")
	}
}
func TestRejectsPersistentAccountMismatch(t *testing.T) {
	r := &runner{status: Status{Account: &Account{UserID: "other"}}}
	if err := Ensure(t.Context(), managed(t), r, func(context.Context, Request) error { return nil }, false); err == nil || r.logins != 0 {
		t.Fatal("覆盖其他账号的持久目录")
	}
}
func TestManagedSpecRequiresBackendNetwork(t *testing.T) {
	s := managed(t)
	s.NetworkPolicy = "isolated"
	if err := s.Validate(); err == nil {
		t.Fatal("隔离网络无法接入后台却通过校验")
	}
	s.NetworkPolicy = "public-only"
	s.Runtime.Server = "https://user:secret@ai.example.com"
	if err := s.Validate(); err == nil {
		t.Fatal("后台地址携带了凭据")
	}
}
