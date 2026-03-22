package runner

import (
	"context"
	"errors"
	"sync"
	"time"
)

var (
	ErrRunnerNotFound = errors.New("runner not found")
	ErrStreamFull     = errors.New("runner stream full")
)

type Connection struct {
	ID       string
	UserID   string
	Stream   chan interface{}
	LastSeen time.Time
}

type Manager struct {
	mu      sync.RWMutex
	runners map[string]*Connection
}

func NewManager() *Manager {
	return &Manager{
		runners: make(map[string]*Connection),
	}
}

func (m *Manager) Register(ctx context.Context, runnerID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.runners[runnerID] = &Connection{
		ID:       runnerID,
		UserID:   userID,
		Stream:   make(chan interface{}, 100),
		LastSeen: time.Now(),
	}

	return nil
}

func (m *Manager) GetRunner(runnerID string) (*Connection, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	conn, ok := m.runners[runnerID]
	return conn, ok
}

func (m *Manager) GetRunnersByUser(userID string) []*Connection {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var runners []*Connection
	for _, conn := range m.runners {
		if conn.UserID == userID {
			runners = append(runners, conn)
		}
	}
	return runners
}

func (m *Manager) UpdateHeartbeat(runnerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if conn, ok := m.runners[runnerID]; ok {
		conn.LastSeen = time.Now()
	}
}

func (m *Manager) SendCommand(runnerID string, cmd interface{}) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if conn, ok := m.runners[runnerID]; ok {
		select {
		case conn.Stream <- cmd:
			return nil
		default:
			return ErrStreamFull
		}
	}
	return ErrRunnerNotFound
}

func (m *Manager) Remove(runnerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if conn, ok := m.runners[runnerID]; ok {
		close(conn.Stream)
		delete(m.runners, runnerID)
	}
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.runners)
}

func (m *Manager) List() []*Connection {
	m.mu.RLock()
	defer m.mu.RUnlock()

	runners := make([]*Connection, 0, len(m.runners))
	for _, conn := range m.runners {
		runners = append(runners, conn)
	}
	return runners
}
