package docker

import (
	"context"
	"log/slog"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type Manager struct {
	client *client.Client
	logger *slog.Logger
}

func NewManager(logger *slog.Logger) (*Manager, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}

	return &Manager{
		client: cli,
		logger: logger,
	}, nil
}

func (m *Manager) Close() error {
	return m.client.Close()
}

func (m *Manager) Ping(ctx context.Context) error {
	_, err := m.client.Ping(ctx)
	return err
}

func (m *Manager) ListContainers(ctx context.Context) ([]container.Summary, error) {
	return m.client.ContainerList(ctx, container.ListOptions{All: true})
}

func (m *Manager) GetContainer(ctx context.Context, containerID string) (container.InspectResponse, error) {
	return m.client.ContainerInspect(ctx, containerID)
}
