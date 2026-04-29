package tasklog

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

type gatewayProviderStub struct {
	name                  string
	queryLatestTurnCalled bool
	queryTurnsCalled      bool
}

func (s *gatewayProviderStub) Name() string {
	return s.name
}

func (s *gatewayProviderStub) QueryLatestTurn(context.Context, uuid.UUID, time.Time, time.Time) (*QueryLatestTurnResp, error) {
	s.queryLatestTurnCalled = true
	return &QueryLatestTurnResp{}, nil
}

func (s *gatewayProviderStub) QueryTurns(context.Context, uuid.UUID, time.Time, string, int) (*QueryTurnsResp, error) {
	s.queryTurnsCalled = true
	return &QueryTurnsResp{}, nil
}

func TestGatewayEmptyStoreUsesLoki(t *testing.T) {
	loki := &gatewayProviderStub{name: "loki"}
	clickHouse := &gatewayProviderStub{name: "clickhouse"}
	gateway := &Gateway{Loki: loki, ClickHouse: clickHouse}

	_, err := gateway.QueryTurns(context.Background(), uuid.New(), time.Now(), "", 10, "")
	if err != nil {
		t.Fatalf("QueryTurns returned error: %v", err)
	}
	if !loki.queryTurnsCalled {
		t.Fatal("expected Loki QueryTurns to be called")
	}
	if clickHouse.queryTurnsCalled {
		t.Fatal("expected ClickHouse QueryTurns not to be called")
	}
}

func TestGatewayClickHouseStoreUsesClickHouse(t *testing.T) {
	loki := &gatewayProviderStub{name: "loki"}
	clickHouse := &gatewayProviderStub{name: "clickhouse"}
	gateway := &Gateway{Loki: loki, ClickHouse: clickHouse}

	_, err := gateway.QueryLatestTurn(context.Background(), uuid.New(), time.Now(), time.Now(), consts.LogStoreClickHouse)
	if err != nil {
		t.Fatalf("QueryLatestTurn returned error: %v", err)
	}
	if !clickHouse.queryLatestTurnCalled {
		t.Fatal("expected ClickHouse QueryLatestTurn to be called")
	}
	if loki.queryLatestTurnCalled {
		t.Fatal("expected Loki QueryLatestTurn not to be called")
	}
}

func TestGatewayUnknownStoreReturnsError(t *testing.T) {
	loki := &gatewayProviderStub{name: "loki"}
	clickHouse := &gatewayProviderStub{name: "clickhouse"}
	gateway := &Gateway{Loki: loki, ClickHouse: clickHouse}

	_, err := gateway.QueryTurns(context.Background(), uuid.New(), time.Now(), "", 10, consts.LogStore("bad-store"))
	if err == nil {
		t.Fatal("expected QueryTurns to return error")
	}
	if !strings.Contains(err.Error(), "unsupported task log store") {
		t.Fatalf("expected unsupported store error, got: %v", err)
	}
	if loki.queryTurnsCalled || clickHouse.queryTurnsCalled {
		t.Fatal("expected no provider to be called")
	}
}

func TestGatewayNilLokiProviderReturnsError(t *testing.T) {
	clickHouse := &gatewayProviderStub{name: "clickhouse"}
	gateway := &Gateway{ClickHouse: clickHouse}

	_, err := gateway.QueryTurns(context.Background(), uuid.New(), time.Now(), "", 10, "")
	if err == nil {
		t.Fatal("expected QueryTurns to return error")
	}
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("expected provider unavailable error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "loki") {
		t.Fatalf("expected error to contain provider name, got: %v", err)
	}
	if clickHouse.queryTurnsCalled {
		t.Fatal("expected ClickHouse QueryTurns not to be called")
	}
}

func TestGatewayNilClickHouseProviderReturnsError(t *testing.T) {
	loki := &gatewayProviderStub{name: "loki"}
	gateway := &Gateway{Loki: loki}

	_, err := gateway.QueryLatestTurn(context.Background(), uuid.New(), time.Now(), time.Now(), consts.LogStoreClickHouse)
	if err == nil {
		t.Fatal("expected QueryLatestTurn to return error")
	}
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("expected provider unavailable error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "clickhouse") {
		t.Fatalf("expected error to contain provider name, got: %v", err)
	}
	if loki.queryLatestTurnCalled {
		t.Fatal("expected Loki QueryLatestTurn not to be called")
	}
}

var _ Provider = (*gatewayProviderStub)(nil)
