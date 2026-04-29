package tasklog

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

type Gateway struct {
	Loki       Provider
	ClickHouse Provider
}

func (g *Gateway) QueryLatestTurn(ctx context.Context, taskID uuid.UUID, taskCreatedAt, end time.Time, store consts.LogStore) (*QueryLatestTurnResp, error) {
	p, err := g.providerByStore(store)
	if err != nil {
		return nil, err
	}
	return p.QueryLatestTurn(ctx, taskID, taskCreatedAt, end)
}

func (g *Gateway) QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int, store consts.LogStore) (*QueryTurnsResp, error) {
	p, err := g.providerByStore(store)
	if err != nil {
		return nil, err
	}
	return p.QueryTurns(ctx, taskID, taskCreatedAt, cursor, limit)
}

func (g *Gateway) providerByStore(store consts.LogStore) (Provider, error) {
	s := consts.LogStore(strings.TrimSpace(string(store)))
	switch s {
	case "", consts.LogStoreLoki:
		return providerOrUnavailable(g.Loki, string(consts.LogStoreLoki))
	case consts.LogStoreClickHouse:
		return providerOrUnavailable(g.ClickHouse, string(consts.LogStoreClickHouse))
	default:
		return nil, fmt.Errorf("unsupported task log store: %q", store)
	}
}

func providerOrUnavailable(p Provider, name string) (Provider, error) {
	if p == nil {
		return nil, fmt.Errorf("%w: %s", ErrProviderUnavailable, name)
	}
	return p, nil
}
