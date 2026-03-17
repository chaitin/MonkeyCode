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

func (v *virtualMachineClient) Create(ctx context.Context, req *CreateVirtualMachineReq) (*VirtualMachine, error) {
	resp, err := request.Post[Resp[*VirtualMachine]](v.client, ctx, "/internal/vm", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (v *virtualMachineClient) Delete(ctx context.Context, req *DeleteVirtualMachineReq) error {
	q := request.Query{
		"id":      req.ID,
		"host_id": req.HostID,
		"user_id": req.UserID,
	}
	_, err := request.Delete[any](v.client, ctx, "/internal/vm", request.WithQuery(q))
	return err
}

func (v *virtualMachineClient) IsOnline(ctx context.Context, req *IsOnlineReq[string]) (*IsOnlineResp, error) {
	resp, err := request.Post[Resp[*IsOnlineResp]](v.client, ctx, "/internal/vm/is-online", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

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

func (v *virtualMachineClient) TerminalList(ctx context.Context, id string) ([]*Terminal, error) {
	resp, err := request.Get[Resp[[]*Terminal]](v.client, ctx, "/internal/terminal", request.WithQuery(
		request.Query{"id": id},
	))
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (v *virtualMachineClient) CloseTerminal(ctx context.Context, req *CloseTerminalReq) error {
	_, err := request.Delete[any](v.client, ctx, "/internal/terminal", request.WithBody(req))
	return err
}
