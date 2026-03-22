package docker

import (
	"context"

	"github.com/docker/docker/api/types/network"
)

func (m *Manager) CreateNetwork(ctx context.Context, name string) (string, error) {
	resp, err := m.client.NetworkCreate(ctx, name, network.CreateOptions{})
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (m *Manager) RemoveNetwork(ctx context.Context, networkID string) error {
	return m.client.NetworkRemove(ctx, networkID)
}

func (m *Manager) ListNetworks(ctx context.Context) ([]network.Inspect, error) {
	return m.client.NetworkList(ctx, network.ListOptions{})
}

func (m *Manager) ConnectNetwork(ctx context.Context, networkID, containerID string) error {
	return m.client.NetworkConnect(ctx, networkID, containerID, &network.EndpointSettings{})
}

func (m *Manager) DisconnectNetwork(ctx context.Context, networkID, containerID string) error {
	return m.client.NetworkDisconnect(ctx, networkID, containerID, false)
}

func (m *Manager) NetworkExists(ctx context.Context, name string) (bool, error) {
	networks, err := m.client.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return false, err
	}

	for _, net := range networks {
		if net.Name == name {
			return true, nil
		}
	}
	return false, nil
}
