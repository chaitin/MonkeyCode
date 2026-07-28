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

func (p *portForwardClient) List(ctx context.Context, req ListPortforwadReq) (*ListPortforwadResp, error) {
	resp, err := request.Get[Resp[*ListPortforwadResp]](p.client, ctx, "/internal/port-forward", request.WithQuery(request.Query{
		"id":         req.ID,
		"request_id": req.RequestId,
	}), routeOption(CapabilityAgent, req.ID))
	if err != nil {
		return nil, parseTaskflowError(err)
	}
	return resp.Data, nil
}

func (p *portForwardClient) Create(ctx context.Context, req CreatePortForward) (*PortForwardInfo, error) {
	resp, err := executeMutation(ctx, targetScope("vm", req.ID), "", func(ctx context.Context) (*Resp[*PortForwardInfo], error) {
		return request.Post[Resp[*PortForwardInfo]](p.client, ctx, "/internal/port-forward", req,
			fencedRouteOption(ctx, CapabilityAgent, req.ID))
	})
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (p *portForwardClient) Close(ctx context.Context, req ClosePortForward) error {
	return executeMutationError(ctx, targetScope("vm", req.ID), req.ForwardID, func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](p.client, ctx, "/internal/port-forward/close", req,
			fencedRouteOption(ctx, CapabilityAgent, req.ID))
		return err
	})
}

func (p *portForwardClient) Update(ctx context.Context, req UpdatePortForward) (*PortForwardInfo, error) {
	resp, err := executeMutation(ctx, targetScope("vm", req.ID), "", func(ctx context.Context) (*Resp[*PortForwardInfo], error) {
		return request.Put[Resp[*PortForwardInfo]](p.client, ctx, "/internal/port-forward", req,
			fencedRouteOption(ctx, CapabilityAgent, req.ID))
	})
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}
