package app

import (
	"context"
	"errors"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/extension"
	"github.com/go-chi/chi/v5"
)

type moduleStub struct {
	failure error
	closed  int
	started chan struct{}
}

func (*moduleStub) RegisterAdmin(chi.Router)  {}
func (*moduleStub) RegisterAgent(chi.Router)  {}
func (*moduleStub) RegisterPublic(chi.Router) {}
func (*moduleStub) RegisterAuth(chi.Router)   {}
func (m *moduleStub) Initialize(context.Context, extension.Services) (extension.Bindings, error) {
	return extension.Bindings{}, m.failure
}
func (m *moduleStub) Run(ctx context.Context) { close(m.started); <-ctx.Done() }
func (m *moduleStub) Close() error            { m.closed++; return nil }
func TestModuleInitializationAndCleanup(t *testing.T) {
	modules, bindings, err := initializeModules(t.Context(), nil, extension.Services{})
	if err != nil || len(modules) != 0 || len(bindings) != 0 {
		t.Fatal("默认入口装配了可选模块")
	}
	first := &moduleStub{}
	failed := &moduleStub{failure: errors.New("unavailable")}
	if _, _, err = initializeModules(t.Context(), []AdminRegistrar{first, failed}, extension.Services{}); err == nil || first.closed != 1 || failed.closed != 1 {
		t.Fatal("初始化失败未释放模块资源", err)
	}
}
func TestModuleWorkersStopBeforeClose(t *testing.T) {
	module := &moduleStub{started: make(chan struct{})}
	ctx, cancel := context.WithCancel(t.Context())
	done := runModules(ctx, []extension.Module{module})
	<-module.started
	cancel()
	<-done
	if err := closeModules([]extension.Module{module}); err != nil || module.closed != 1 {
		t.Fatal("模块未正常关闭", err)
	}
}
