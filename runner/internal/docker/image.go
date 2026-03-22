package docker

import (
	"context"
	"io"

	"github.com/docker/docker/api/types/image"
)

func (m *Manager) PullImage(ctx context.Context, imageName string) error {
	reader, err := m.client.ImagePull(ctx, imageName, image.PullOptions{})
	if err != nil {
		return err
	}
	defer reader.Close()

	_, err = io.Copy(io.Discard, reader)
	return err
}

func (m *Manager) ListImages(ctx context.Context) ([]image.Summary, error) {
	return m.client.ImageList(ctx, image.ListOptions{})
}

func (m *Manager) ImageExists(ctx context.Context, imageName string) (bool, error) {
	images, err := m.client.ImageList(ctx, image.ListOptions{
		All: false,
	})
	if err != nil {
		return false, err
	}

	for _, img := range images {
		for _, tag := range img.RepoTags {
			if tag == imageName {
				return true, nil
			}
		}
	}
	return false, nil
}

func (m *Manager) RemoveImage(ctx context.Context, imageID string) error {
	_, err := m.client.ImageRemove(ctx, imageID, image.RemoveOptions{})
	return err
}
