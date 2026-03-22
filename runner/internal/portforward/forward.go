package portforward

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"
)

type Forwarder struct {
	logger *slog.Logger
}

func NewForwarder(logger *slog.Logger) *Forwarder {
	return &Forwarder{logger: logger}
}

type Forward struct {
	ID          string
	ContainerID string
	HostPort    int
	ContainerPort int
	Protocol    string
	Listener    net.Listener
	Cancel      context.CancelFunc
}

func (f *Forwarder) Start(ctx context.Context, containerID string, hostPort, containerPort int, protocol string) (*Forward, error) {
	if containerID == "" {
		return nil, fmt.Errorf("container_id is required")
	}

	listener, err := net.Listen(f.protocolForNet(protocol), fmt.Sprintf(":%d", hostPort))
	if err != nil {
		return nil, fmt.Errorf("failed to listen on port %d: %w", hostPort, err)
	}

	ctx, cancel := context.WithCancel(ctx)

	fwd := &Forward{
		ID:          fmt.Sprintf("%s-%d-%d", containerID[:8], hostPort, containerPort),
		ContainerID: containerID,
		HostPort:    hostPort,
		ContainerPort: containerPort,
		Protocol:    protocol,
		Listener:    listener,
		Cancel:      cancel,
	}

	go f.acceptConnections(ctx, fwd)

	f.logger.Info("port forward started", "container", containerID[:8], "host_port", hostPort, "container_port", containerPort)

	return fwd, nil
}

func (f *Forwarder) acceptConnections(ctx context.Context, fwd *Forward) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			conn, err := fwd.Listener.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				f.logger.Debug("accept error", "error", err)
				continue
			}

			go f.handleConnection(ctx, fwd, conn)
		}
	}
}

func (f *Forwarder) handleConnection(ctx context.Context, fwd *Forward, conn net.Conn) {
	defer conn.Close()

	containerConn, err := f.connectToContainer(ctx, fwd)
	if err != nil {
		f.logger.Debug("failed to connect to container", "error", err)
		return
	}
	defer containerConn.Close()

	go f.copyData(conn, containerConn)
	f.copyData(containerConn, conn)
}

func (f *Forwarder) connectToContainer(ctx context.Context, fwd *Forward) (net.Conn, error) {
	dialer := net.Dialer{
		Timeout: 5 * time.Second,
	}

	addr := fmt.Sprintf("127.0.0.1:%d", fwd.ContainerPort)
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func (f *Forwarder) copyData(dst net.Conn, src net.Conn) {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if err != nil {
		return
		}
		if _, err := dst.Write(buf[:n]); err != nil {
		return
		}
	}
}

func (f *Forwarder) protocolForNet(protocol string) string {
	switch protocol {
	case "tcp":
		return "tcp"
	case "udp":
		return "udp"
	default:
		return "tcp"
	}
}

func (f *Forwarder) Stop(fwd *Forward) error {
	if fwd.Listener != nil {
		if err := fwd.Listener.Close(); err != nil {
		return err
		}
	}
	if fwd.Cancel != nil {
		fwd.Cancel()
	}
	f.logger.Info("port forward stopped", "id", fwd.ID)
	return nil
}

type Manager struct {
	forwarder *Forwarder
	forwards map[string]*Forward
	mu       sync.RWMutex
	logger   *slog.Logger
}

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		forwarder: NewForwarder(logger),
		forwards: make(map[string]*Forward),
		logger:   logger,
	}
}

func (m *Manager) Start(ctx context.Context, containerID string, hostPort, containerPort int, protocol string) (*Forward, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	fwd, err := m.forwarder.Start(ctx, containerID, hostPort, containerPort, protocol)
	if err != nil {
		return nil, err
	}

	m.forwards[fwd.ID] = fwd
	return fwd, nil
}

func (m *Manager) Stop(forwardID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	fwd, ok := m.forwards[forwardID]
	if !ok {
		return nil
	}

	if err := m.forwarder.Stop(fwd); err != nil {
		return err
	}

	delete(m.forwards, forwardID)
	return nil
}

func (m *Manager) Get(forwardID string) (*Forward, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	fwd, ok := m.forwards[forwardID]
	return fwd, ok
}

func (m *Manager) List() []*Forward {
	m.mu.RLock()
	defer m.mu.RUnlock()

	forwards := make([]*Forward, 0, len(m.forwards))
	for _, fwd := range m.forwards {
		forwards = append(forwards, fwd)
	}
	return forwards
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, fwd := range m.forwards {
		m.forwarder.Stop(fwd)
	}
	m.forwards = make(map[string]*Forward)
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.forwards)
}
