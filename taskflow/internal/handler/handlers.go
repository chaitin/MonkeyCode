package handler

import (
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type Handlers struct {
	Host  *HostHandler
	VM    *VMHandler
	Task  *TaskHandler
	Stats *StatsHandler
}

func NewHandlers(s *store.RedisStore, m *runner.Manager) *Handlers {
	return &Handlers{
		Host:  NewHostHandler(s),
		VM:    NewVMHandler(s, m),
		Task:  NewTaskHandler(s),
		Stats: NewStatsHandler(s, m),
	}
}
