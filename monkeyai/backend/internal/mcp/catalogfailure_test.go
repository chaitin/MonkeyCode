package mcp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestCatalogToolsPreservesCancellationAndAuthorization(t *testing.T) {
	service := NewService(nil, "")
	connector := resource.Object{"id": "connector", "authorization_mode": "independent"}
	if _, err := service.catalogTools(t.Context(), nil, connector, nil, resource.Object{}); !errors.Is(err, authorizationRequired) {
		t.Fatalf("目录降级不应绕过认证检查: %v", err)
	}

	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(remote.Close)
	connector = resource.Object{"id": "connector", "authorization_mode": "none", "url": remote.URL}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	view := resource.Object{}
	if _, err := service.catalogTools(ctx, nil, connector, nil, view); !errors.Is(err, context.Canceled) {
		t.Fatalf("请求取消不应被吞掉: %v", err)
	}
	if view.String("connection_status") != "" {
		t.Fatalf("请求取消不应标记远端连接故障: %v", view)
	}
}
