package app

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/extension"
)

func initializeModules(ctx context.Context, registrars []AdminRegistrar, services extension.Services) ([]extension.Module, []extension.Bindings, error) {
	var modules []extension.Module
	var bindings []extension.Bindings
	for _, registrar := range registrars {
		module, ok := registrar.(extension.Module)
		if !ok {
			continue
		}
		binding, err := module.Initialize(ctx, services)
		if err != nil {
			return nil, nil, errors.Join(err, module.Close(), closeModules(modules))
		}
		modules = append(modules, module)
		bindings = append(bindings, binding)
	}
	return modules, bindings, nil
}

func closeModules(modules []extension.Module) error {
	var result error
	for i := len(modules) - 1; i >= 0; i-- {
		result = errors.Join(result, modules[i].Close())
	}
	return result
}
func runModules(ctx context.Context, modules []extension.Module) <-chan struct{} {
	done := make(chan struct{})
	var group sync.WaitGroup
	for _, module := range modules {
		group.Go(func() { module.Run(ctx) })
	}
	go func() { group.Wait(); close(done) }()
	return done
}
func logModuleClose(modules []extension.Module) {
	if err := closeModules(modules); err != nil {
		slog.Error("关闭宿主扩展失败", "error", err)
	}
}
