package vm

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/runner/internal/docker"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusCreating  Status = "creating"
	StatusRunning   Status = "running"
	StatusStopped   Status = "stopped"
	StatusError     Status = "error"
	StatusDeleted   Status = "deleted"
)

type VM struct {
	ID          string
	ContainerID string
	UserID      string
	Status      Status
	ImageURL    string
	GitURL      string
	CreatedAt   time.Time
	Error       string
}

type Manager struct {
	docker *docker.Manager
	mu     sync.RWMutex
	vms    map[string]*VM
}

func NewManager(dockerMgr *docker.Manager) *Manager {
	return &Manager{
		docker: dockerMgr,
		vms:    make(map[string]*VM),
	}
}

type CreateOptions struct {
	UserID      string
	ImageURL    string
	GitURL      string
	GitToken    string
	Cores       int64
	Memory      int64
	EnvVars     map[string]string
	TTLSeconds  int64
}

func (m *Manager) Create(ctx context.Context, opts CreateOptions) (*VM, error) {
	vmID := uuid.New().String()

	vm := &VM{
		ID:        vmID,
		UserID:    opts.UserID,
		Status:    StatusPending,
		ImageURL:  opts.ImageURL,
		GitURL:    opts.GitURL,
		CreatedAt: time.Now(),
	}

	m.mu.Lock()
	m.vms[vmID] = vm
	m.mu.Unlock()

	go m.provisionVM(vmID, opts)

	return vm, nil
}

func (m *Manager) provisionVM(vmID string, opts CreateOptions) {
	ctx := context.Background()

	m.updateStatus(vmID, StatusCreating)

	image := opts.ImageURL
	if image == "" {
		image = "ubuntu:22.04"
	}

	if err := m.docker.PullImage(ctx, image); err != nil {
		m.setError(vmID, fmt.Sprintf("failed to pull image: %v", err))
		return
	}

	envVars := make([]string, 0)
	for k, v := range opts.EnvVars {
		envVars = append(envVars, fmt.Sprintf("%s=%s", k, v))
	}

	if opts.GitToken != "" {
		envVars = append(envVars, fmt.Sprintf("GIT_TOKEN=%s", opts.GitToken))
	}

	containerID, err := m.docker.CreateContainer(ctx, docker.CreateContainerOptions{
		Name:       fmt.Sprintf("vm-%s", vmID),
		Image:      image,
		Env:        envVars,
		WorkingDir: "/workspace",
		CPUCount:   opts.Cores,
		Memory:     opts.Memory,
	})
	if err != nil {
		m.setError(vmID, fmt.Sprintf("failed to create container: %v", err))
		return
	}

	if err := m.docker.StartContainer(ctx, containerID); err != nil {
		m.setError(vmID, fmt.Sprintf("failed to start container: %v", err))
		return
	}

	m.mu.Lock()
	if vm, ok := m.vms[vmID]; ok {
		vm.ContainerID = containerID
		vm.Status = StatusRunning
	}
	m.mu.Unlock()
}

func (m *Manager) Delete(ctx context.Context, vmID string) error {
	m.mu.RLock()
	vm, ok := m.vms[vmID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("vm not found: %s", vmID)
	}

	if vm.ContainerID != "" {
		timeout := 10
		if err := m.docker.StopContainer(ctx, vm.ContainerID, &timeout); err != nil {
			m.docker.RemoveContainer(ctx, vm.ContainerID, true)
		} else {
			m.docker.RemoveContainer(ctx, vm.ContainerID, false)
		}
	}

	m.updateStatus(vmID, StatusDeleted)
	return nil
}

func (m *Manager) Get(vmID string) (*VM, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	vm, ok := m.vms[vmID]
	if !ok {
		return nil, fmt.Errorf("vm not found: %s", vmID)
	}
	return vm, nil
}

func (m *Manager) List(userID string) []*VM {
	m.mu.RLock()
	defer m.mu.RUnlock()

	vms := make([]*VM, 0)
	for _, vm := range m.vms {
		if userID == "" || vm.UserID == userID {
			vms = append(vms, vm)
		}
	}
	return vms
}

func (m *Manager) updateStatus(vmID string, status Status) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if vm, ok := m.vms[vmID]; ok {
		vm.Status = status
	}
}

func (m *Manager) setError(vmID string, errMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if vm, ok := m.vms[vmID]; ok {
		vm.Status = StatusError
		vm.Error = errMsg
	}
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.vms)
}

func (m *Manager) RunningCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, vm := range m.vms {
		if vm.Status == StatusRunning {
			count++
		}
	}
	return count
}
