package terminal

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type Terminal struct {
	ID          string
	VMID        string
	ContainerID string

	mu       sync.Mutex
	client   *client.Client
	conn     io.ReadWriteCloser
	execID   string
	resizeCh chan Resize
	done     chan struct{}
}

type Resize struct {
	Cols uint16
	Rows uint16
}

func New(id, vmID, containerID string, cli *client.Client) *Terminal {
	return &Terminal{
		ID:          id,
		VMID:        vmID,
		ContainerID: containerID,
		client:      cli,
		resizeCh:    make(chan Resize, 10),
		done:        make(chan struct{}),
	}
}

func (t *Terminal) Start(ctx context.Context, cmd []string, initialResize *Resize) error {
	execConfig := container.ExecOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
		Cmd:          cmd,
	}

	if len(cmd) == 0 {
		execConfig.Cmd = []string{"/bin/bash"}
	}

	execResp, err := t.client.ContainerExecCreate(ctx, t.ContainerID, execConfig)
	if err != nil {
		return fmt.Errorf("failed to create exec: %w", err)
	}

	conn, err := t.client.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{
		Tty: true,
	})
	if err != nil {
		return fmt.Errorf("failed to attach exec: %w", err)
	}

	t.mu.Lock()
	t.conn = conn.Conn
	t.execID = execResp.ID
	t.mu.Unlock()

	if initialResize != nil {
		t.Resize(*initialResize)
	}

	go t.handleResize(ctx)

	return nil
}

func (t *Terminal) handleResize(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.done:
			return
		case resize := <-t.resizeCh:
			t.client.ContainerExecResize(ctx, t.execID, container.ResizeOptions{
				Height: uint(resize.Rows),
				Width:  uint(resize.Cols),
			})
		}
	}
}

func (t *Terminal) Resize(resize Resize) {
	select {
	case t.resizeCh <- resize:
	default:
	}
}

func (t *Terminal) Write(data []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return 0, io.ErrClosedPipe
	}
	return t.conn.Write(data)
}

func (t *Terminal) Read(data []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return 0, io.ErrClosedPipe
	}
	return t.conn.Read(data)
}

func (t *Terminal) Close() error {
	select {
	case <-t.done:
		return nil
	default:
	}

	close(t.done)

	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn != nil {
		t.conn.Close()
		t.conn = nil
	}
	return nil
}

func (t *Terminal) Done() <-chan struct{} {
	return t.done
}
