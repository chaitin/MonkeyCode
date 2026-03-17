package taskflow

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type portForwardClient struct {
	client *request.Client
}

func newPortForwardClient(client *request.Client) PortForwarder {
	return &portForwardClient{client: client}
}

func (p *portForwardClient) List(ctx context.Context, id string) ([]*PortForwardInfo, error) {
	resp, err := request.Get[Resp[[]*PortForwardInfo]](p.client, ctx, "/internal/port-forward", request.WithQuery(request.Query{
		"id": id,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (p *portForwardClient) Create(ctx context.Context, req CreatePortForward) (*PortForwardInfo, error) {
	resp, err := request.Post[Resp[*PortForwardInfo]](p.client, ctx, "/internal/port-forward", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (p *portForwardClient) Close(ctx context.Context, req ClosePortForward) error {
	_, err := request.Post[Resp[any]](p.client, ctx, "/internal/port-forward/close", req)
	return err
}

func (p *portForwardClient) Update(ctx context.Context, req UpdatePortForward) (*PortForwardInfo, error) {
	resp, err := request.Put[Resp[*PortForwardInfo]](p.client, ctx, "/internal/port-forward", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}
