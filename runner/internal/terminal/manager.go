package terminal

import (
	"context"
	"log/slog"
	"sync"

	"github.com/docker/docker/client"
)

type Manager struct {
	terminals map[string]*Terminal
	mu        sync.RWMutex
	logger    *slog.Logger
	dockerCli *client.Client
}

func NewManager(logger *slog.Logger, dockerCli *client.Client) *Manager {
	return &Manager{
		terminals: make(map[string]*Terminal),
		logger:    logger,
		dockerCli: dockerCli,
	}
}

func (m *Manager) Create(ctx context.Context, id, vmID, containerID string, cmd []string, initialResize *Resize) (*Terminal, error) {
	term := New(id, vmID, containerID, m.dockerCli)

	if err := term.Start(ctx, cmd, initialResize); err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.terminals[id] = term
	m.mu.Unlock()

	go func() {
		<-term.Done()
		m.Remove(id)
	}()

	return term, nil
}

func (m *Manager) Get(id string) (*Terminal, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	term, ok := m.terminals[id]
	return term, ok
}

func (m *Manager) Remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if term, ok := m.terminals[id]; ok {
		term.Close()
		delete(m.terminals, id)
	}
}

func (m *Manager) List() []*Terminal {
	m.mu.RLock()
	defer m.mu.RUnlock()

	terminals := make([]*Terminal, 0, len(m.terminals))
	for _, term := range m.terminals {
		terminals = append(terminals, term)
	}
	return terminals
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.terminals)
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, term := range m.terminals {
		term.Close()
	}
	m.terminals = make(map[string]*Terminal)
}
