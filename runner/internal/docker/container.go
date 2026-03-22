package docker

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/go-connections/nat"
)

type CreateContainerOptions struct {
	Name       string
	Image      string
	Cmd        []string
	Env        []string
	WorkingDir string
	CPUCount   int64
	Memory     int64
	Ports      []string
	Mounts     []MountSpec
}

type MountSpec struct {
	Source   string
	Target   string
	ReadOnly bool
}

func (m *Manager) CreateContainer(ctx context.Context, opts CreateContainerOptions) (string, error) {
	config := &container.Config{
		Image:      opts.Image,
		Cmd:        opts.Cmd,
		Env:        opts.Env,
		WorkingDir: opts.WorkingDir,
		Tty:        true,
		OpenStdin:  true,
	}

	hostConfig := &container.HostConfig{
		Resources: container.Resources{
			NanoCPUs: opts.CPUCount * 1e9,
			Memory:   opts.Memory * 1024 * 1024,
		},
		AutoRemove: false,
	}

	if len(opts.Ports) > 0 {
		portMap := make(nat.PortMap)
		for _, p := range opts.Ports {
			port := nat.Port(p)
			portMap[port] = []nat.PortBinding{{HostIP: "0.0.0.0", HostPort: ""}}
		}
		hostConfig.PortBindings = portMap
	}

	if len(opts.Mounts) > 0 {
		mounts := make([]mount.Mount, 0, len(opts.Mounts))
		for _, mnt := range opts.Mounts {
			mounts = append(mounts, mount.Mount{
				Type:     mount.TypeBind,
				Source:   mnt.Source,
				Target:   mnt.Target,
				ReadOnly: mnt.ReadOnly,
			})
		}
		hostConfig.Mounts = mounts
	}

	resp, err := m.client.ContainerCreate(ctx, config, hostConfig, nil, nil, opts.Name)
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}

	return resp.ID, nil
}

func (m *Manager) StartContainer(ctx context.Context, containerID string) error {
	return m.client.ContainerStart(ctx, containerID, container.StartOptions{})
}

func (m *Manager) StopContainer(ctx context.Context, containerID string, timeout *int) error {
	if timeout == nil {
		t := 10
		timeout = &t
	}
	return m.client.ContainerStop(ctx, containerID, container.StopOptions{Timeout: timeout})
}

func (m *Manager) RemoveContainer(ctx context.Context, containerID string, force bool) error {
	return m.client.ContainerRemove(ctx, containerID, container.RemoveOptions{
		Force:         force,
		RemoveVolumes: true,
	})
}

func (m *Manager) WaitContainer(ctx context.Context, containerID string) (int64, error) {
	statusCh, errCh := m.client.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		return -1, err
	case status := <-statusCh:
		return status.StatusCode, nil
	}
}

func (m *Manager) ContainerLogs(ctx context.Context, containerID string, stdout, stderr bool) (io.ReadCloser, error) {
	return m.client.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: stdout,
		ShowStderr: stderr,
		Follow:     false,
		Tail:       "100",
	})
}

func (m *Manager) ContainerExec(ctx context.Context, containerID string, cmd []string) (string, error) {
	execConfig := container.ExecOptions{
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          cmd,
	}

	execResp, err := m.client.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return "", err
	}

	attachResp, err := m.client.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", err
	}
	defer attachResp.Close()

	output, err := io.ReadAll(attachResp.Reader)
	if err != nil {
		return "", err
	}

	return string(output), nil
}

func (m *Manager) ContainerStatus(ctx context.Context, containerID string) (string, error) {
	info, err := m.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return "", err
	}
	return info.State.Status, nil
}

func (m *Manager) WaitForRunning(ctx context.Context, containerID string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			status, err := m.ContainerStatus(ctx, containerID)
			if err != nil {
				return err
			}
			if status == "running" {
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}
