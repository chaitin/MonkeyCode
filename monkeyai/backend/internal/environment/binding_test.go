package environment

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestRuntimeIdentityIsUniqueCompleteAndGenerationBound(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	first, err := s.Create(ctx, user, Creation{"first", "first"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, user, Creation{"second", "second"})
	if err != nil {
		t.Fatal(err)
	}
	bind := sqlc.BindRuntimeParams{EnvironmentID: first.Environment.ID, MachineID: resource.ID(), PublicKey: bytes.Repeat([]byte{1}, 32), InstanceID: first.Environment.InstanceID, Generation: 1}
	if n, err := q.BindRuntime(ctx, bind); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	wrong := bind
	wrong.MachineID = resource.ID()
	if n, err := q.BindRuntime(ctx, wrong); err != nil || n != 0 {
		t.Fatal("覆盖已有身份", n, err)
	}
	wrong = bind
	wrong.Generation = 2
	if n, err := q.BindRuntime(ctx, wrong); err != nil || n != 0 {
		t.Fatal("接受过期代次", n, err)
	}
	wrong = bind
	wrong.EnvironmentID = second.Environment.ID
	wrong.InstanceID = second.Environment.InstanceID
	if _, err := q.BindRuntime(ctx, wrong); err == nil {
		t.Fatal("同一机器绑定多个环境")
	}
	_, err = s.pool.Exec(ctx, "UPDATE environment_runtimes SET public_key=NULL WHERE environment_id=$1", first.Environment.ID)
	if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "23514" {
		t.Fatal("允许部分身份写入", err)
	}
	actual, err := q.GetRuntime(ctx, first.Environment.ID)
	if err != nil || actual.MachineID == nil || *actual.MachineID != bind.MachineID || !bytes.Equal(actual.PublicKey, bind.PublicKey) {
		t.Fatal("冲突改变已有身份", actual, err)
	}
}

func TestRuntimeRefreshWaitsForBindingCommit(t *testing.T) {
	s, created, host, auth := managedEnvironment(t)
	ctx := t.Context()
	in := runtimeRequest(created.Environment)
	if err := s.approveRuntime(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	auth.check = func(context.Context, pgx.Tx) error { close(entered); <-release; return nil }
	finished := make(chan error, 1)
	in.UserCode = ""
	go func() { finished <- s.approveRuntime(ctx, host, in) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("身份绑定未开始")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	waiting, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	_, err = s.RuntimeAllowed(waiting, tx, created.Environment.UserID, in.MachineID)
	cancel()
	_ = tx.Rollback(ctx)
	close(release)
	if err == nil {
		t.Fatal("身份未提交时刷新越过环境锁")
	}
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("身份绑定与授权刷新死锁")
	}
	tx, err = s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if allowed, err := s.RuntimeAllowed(ctx, tx, created.Environment.UserID, in.MachineID); err != nil || !allowed {
		t.Fatal("绑定提交后无法刷新", allowed, err)
	}
}
