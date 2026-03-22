package task

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/runner/internal/agent"
)

type Executor struct {
	taskMgr  *Manager
	agent    *agent.OpenCodeAgent
	logger   *slog.Logger
	running  map[string]context.CancelFunc
	mu       sync.RWMutex
	reportCh chan Report
}

type Report struct {
	TaskID    string
	Source    string
	Timestamp int64
	Data      []byte
}

func NewExecutor(taskMgr *Manager, ag *agent.OpenCodeAgent, logger *slog.Logger) *Executor {
	return &Executor{
		taskMgr:  taskMgr,
		agent:    ag,
		logger:   logger,
		running:  make(map[string]context.CancelFunc),
		reportCh: make(chan Report, 1000),
	}
}

func (e *Executor) Start(ctx context.Context, taskID string, workDir string) error {
	task, err := e.taskMgr.Get(taskID)
	if err != nil {
		return err
	}

	e.mu.Lock()
	if _, exists := e.running[taskID]; exists {
		e.mu.Unlock()
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)
	e.running[taskID] = cancel
	e.mu.Unlock()

	e.taskMgr.UpdateStatus(taskID, StatusRunning)

	go e.executeTask(ctx, task, workDir)

	return nil
}

func (e *Executor) executeTask(ctx context.Context, task *Task, workDir string) {
	defer func() {
		e.mu.Lock()
		delete(e.running, task.ID)
		e.mu.Unlock()
	}()

	opts := agent.ExecuteOptions{
		TaskID:  task.ID,
		WorkDir: workDir,
		Text:    task.Text,
		Model:   task.Model,
		Timeout: 30 * time.Minute,
	}

	progressCb := func(source string, data []byte) {
		e.reportCh <- Report{
			TaskID:    task.ID,
			Source:    source,
			Timestamp: time.Now().Unix(),
			Data:      data,
		}
	}

	result, err := e.agent.Execute(ctx, opts, progressCb)
	if err != nil {
		e.logger.Error("task execution failed", "task_id", task.ID, "error", err)
		e.taskMgr.SetError(task.ID, err.Error())
		return
	}

	if result.ExitCode != 0 {
		e.taskMgr.SetError(task.ID, result.Error)
		return
	}

	e.taskMgr.SetResult(task.ID, result.Output)
	e.logger.Info("task completed", "task_id", task.ID, "duration", result.Duration)
}

func (e *Executor) Stop(taskID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	cancel, exists := e.running[taskID]
	if !exists {
		return nil
	}

	cancel()
	delete(e.running, taskID)

	e.taskMgr.Cancel(taskID)
	e.logger.Info("task stopped", "task_id", taskID)

	return nil
}

func (e *Executor) IsRunning(taskID string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()

	_, exists := e.running[taskID]
	return exists
}

func (e *Executor) Reports() <-chan Report {
	return e.reportCh
}

func (e *Executor) RunningCount() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return len(e.running)
}

func (e *Executor) StopAll() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for taskID, cancel := range e.running {
		cancel()
		e.taskMgr.Cancel(taskID)
	}
	e.running = make(map[string]context.CancelFunc)
}
