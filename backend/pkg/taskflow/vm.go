package taskflow

import (
	"context"
	"fmt"
	"net/url"

	"github.com/coder/websocket"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type virtualMachineClient struct {
	client *request.Client
}

func newVirtualMachineClient(client *request.Client) VirtualMachiner {
	return &virtualMachineClient{client: client}
}

// Create implements VirtualMachiner.
func (v *virtualMachineClient) Create(ctx context.Context, req *CreateVirtualMachineReq) (*VirtualMachine, error) {
	resp, err := request.Post[Resp[*VirtualMachine]](v.client, ctx, "/internal/vm", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// Delete implements VirtualMachiner.
func (v *virtualMachineClient) Delete(ctx context.Context, req *DeleteVirtualMachineReq) error {
	q := request.Query{
		"id":      req.ID,
		"host_id": req.HostID,
		"user_id": req.UserID,
	}
	_, err := request.Delete[any](v.client, ctx, "/internal/vm", request.WithQuery(q))
	return err
}

// List implements VirtualMachiner.
func (v *virtualMachineClient) List(ctx context.Context, id string) ([]*VirtualMachine, error) {
	q := request.Query{
		"id": id,
	}
	resp, err := request.Get[Resp[[]*VirtualMachine]](v.client, ctx, "/internal/vm/list", request.WithQuery(q))
	if err != nil {
		return []*VirtualMachine{}, err
	}
	return resp.Data, nil
}

// Info implements VirtualMachiner.
func (v *virtualMachineClient) Info(ctx context.Context, req VirtualMachineInfoReq) (*VirtualMachine, error) {
	q := request.Query{
		"id":      req.ID,
		"user_id": req.UserID,
	}
	resp, err := request.Get[Resp[*VirtualMachine]](v.client, ctx, "/internal/vm/info", request.WithQuery(q))
	if err != nil {
		return &VirtualMachine{}, err
	}
	return resp.Data, nil
}

// IsOnline implements VirtualMachiner.
func (v *virtualMachineClient) IsOnline(ctx context.Context, req *IsOnlineReq[string]) (*IsOnlineResp, error) {
	resp, err := request.Post[Resp[*IsOnlineResp]](v.client, ctx, "/internal/vm/is-online", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// Terminal implements VirtualMachiner.
func (v *virtualMachineClient) Terminal(ctx context.Context, req *TerminalReq) (Sheller, error) {
	wsScheme := "ws"
	if v.client.GetScheme() == "https" {
		wsScheme = "wss"
	}

	dial := func(ctx context.Context) (*websocket.Conn, error) {
		u := &url.URL{
			Scheme: wsScheme,
			Host:   v.client.GetHost(),
			Path:   "/internal/ws/terminal",
		}
		values := url.Values{}
		values.Add("id", req.ID)
		values.Add("col", fmt.Sprintf("%d", req.Col))
		values.Add("row", fmt.Sprintf("%d", req.Row))
		values.Add("terminal_id", req.TerminalID)
		values.Add("exec", req.Exec)
		values.Add("mode", fmt.Sprintf("%d", req.Mode))
		u.RawQuery = values.Encode()

		conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{})
		if err != nil {
			return nil, err
		}
		return conn, nil
	}

	conn, err := dial(ctx)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancelCause(ctx)
	shell := &Shell{
		ctx:    ctx,
		cancel: cancel,
		conn:   conn,
		dial:   dial,
	}
	shell.startPing()

	return shell, nil
}

// Reports implements VirtualMachiner.
func (v *virtualMachineClient) Reports(ctx context.Context, req ReportSubscribeReq) (Reporter, error) {
	wsScheme := "ws"
	if v.client.GetScheme() == "https" {
		wsScheme = "wss"
	}

	u := &url.URL{
		Scheme: wsScheme,
		Host:   v.client.GetHost(),
		Path:   "/internal/ws/reports",
	}

	values := url.Values{}
	values.Add("id", req.ID)
	if req.FromID != "" {
		values.Add("from_id", req.FromID)
	}
	if req.History > 0 {
		values.Add("history", fmt.Sprintf("%d", req.History))
	}
	u.RawQuery = values.Encode()

	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{})
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancelCause(ctx)

	return &ReportsStream{
		ctx:    ctx,
		cancel: cancel,
		conn:   conn,
	}, nil
}

// TerminalList implements VirtualMachiner.
func (v *virtualMachineClient) TerminalList(ctx context.Context, id string) ([]*Terminal, error) {
	resp, err := request.Get[Resp[[]*Terminal]](v.client, ctx, "/internal/terminal", request.WithQuery(
		request.Query{"id": id},
	))
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// CloseTerminal implements VirtualMachiner.
func (v *virtualMachineClient) CloseTerminal(ctx context.Context, req *CloseTerminalReq) error {
	_, err := request.Delete[any](v.client, ctx, "/internal/terminal", request.WithBody(req))
	return err
}

// Hibernate implements [VirtualMachiner].
func (v *virtualMachineClient) Hibernate(ctx context.Context, req *HibernateVirtualMachineReq) error {
	_, err := request.Post[Resp[any]](v.client, ctx, "/internal/vm/hibernate", req)
	if err != nil {
		return err
	}
	return nil
}

// Resume implements [VirtualMachiner].
func (v *virtualMachineClient) Resume(ctx context.Context, req *ResumeVirtualMachineReq) error {
	_, err := request.Post[Resp[any]](v.client, ctx, "/internal/vm/resume", req)
	if err != nil {
		return err
	}
	return nil
}
