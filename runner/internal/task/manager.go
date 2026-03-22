package task

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

type Task struct {
	ID        string
	VMID      string
	UserID    string
	Status    Status
	Agent     string
	Text      string
	Model     string
	CreatedAt time.Time
	StartedAt *time.Time
	EndedAt   *time.Time
	Error     string
	Result    string
}

type CreateOptions struct {
	VMID   string
	UserID string
	Text   string
	Model  string
	Agent  string
}

type Manager struct {
	tasks map[string]*Task
	mu    sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		tasks: make(map[string]*Task),
	}
}

func (m *Manager) Create(opts CreateOptions) (*Task, error) {
	if opts.VMID == "" {
		return nil, fmt.Errorf("vm_id is required")
	}
	if opts.Text == "" {
		return nil, fmt.Errorf("text is required")
	}

	taskID := uuid.New().String()

	task := &Task{
		ID:        taskID,
		VMID:      opts.VMID,
		UserID:    opts.UserID,
		Status:    StatusPending,
		Agent:     opts.Agent,
		Text:      opts.Text,
		Model:     opts.Model,
		CreatedAt: time.Now(),
	}

	if task.Agent == "" {
		task.Agent = "opencode"
	}

	m.mu.Lock()
	m.tasks[taskID] = task
	m.mu.Unlock()

	return task, nil
}

func (m *Manager) Get(taskID string) (*Task, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	task, ok := m.tasks[taskID]
	if !ok {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}
	return task, nil
}

func (m *Manager) UpdateStatus(taskID string, status Status) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[taskID]
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}

	task.Status = status

	now := time.Now()
	if status == StatusRunning && task.StartedAt == nil {
		task.StartedAt = &now
	}
	if status == StatusCompleted || status == StatusFailed || status == StatusCancelled {
		task.EndedAt = &now
	}

	return nil
}

func (m *Manager) SetError(taskID string, errMsg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[taskID]
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}

	task.Status = StatusFailed
	task.Error = errMsg
	now := time.Now()
	task.EndedAt = &now

	return nil
}

func (m *Manager) SetResult(taskID string, result string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[taskID]
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}

	task.Status = StatusCompleted
	task.Result = result
	now := time.Now()
	task.EndedAt = &now

	return nil
}

func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[taskID]
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}

	if task.Status == StatusRunning || task.Status == StatusPending {
		task.Status = StatusCancelled
		now := time.Now()
		task.EndedAt = &now
	}

	return nil
}

func (m *Manager) List(userID string) []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()

	tasks := make([]*Task, 0)
	for _, task := range m.tasks {
		if userID == "" || task.UserID == userID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

func (m *Manager) ListByVM(vmID string) []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()

	tasks := make([]*Task, 0)
	for _, task := range m.tasks {
		if task.VMID == vmID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.tasks)
}

func (m *Manager) RunningCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, task := range m.tasks {
		if task.Status == StatusRunning {
			count++
		}
	}
	return count
}

func (m *Manager) Delete(taskID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.tasks[taskID]; !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}

	delete(m.tasks, taskID)
	return nil
}
