package taskflow

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type hostClient struct {
	client *request.Client
}

func newHostClient(client *request.Client) Hoster {
	return &hostClient{client: client}
}

func (h *hostClient) List(ctx context.Context, userID string) (map[string]*Host, error) {
	resp, err := request.Get[Resp[map[string]*Host]](h.client, ctx, "/internal/host/list", request.WithQuery(request.Query{
		"user_id": userID,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (h *hostClient) IsOnline(ctx context.Context, req *IsOnlineReq[string]) (*IsOnlineResp, error) {
	resp, err := request.Post[Resp[*IsOnlineResp]](h.client, ctx, "/internal/host/is-online", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}
