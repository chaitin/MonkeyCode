package usecase

import (
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestBuildMCPConfigsWithHubEnabled(t *testing.T) {
	taskID := uuid.New()
	uc := &TaskUsecase{
		cfg: &config.Config{
			MCPHub: config.MCPHub{
				Enabled: true,
				URL:     "http://mcp-hub:8897/mcp",
				Token:   "shared-token",
			},
			Context7ApiKey: "context7-key",
		},
	}

	mcps := uc.buildMCPConfigs(taskID)
	if len(mcps) != 1 {
		t.Fatalf("expected one mcp config, got %d", len(mcps))
	}
	if mcps[0].Name != "mcphub" {
		t.Fatalf("expected mcp name mcphub, got %s", mcps[0].Name)
	}
	if mcps[0].Type != "http" {
		t.Fatalf("expected mcp type http, got %s", mcps[0].Type)
	}
	if mcps[0].Url == nil || *mcps[0].Url != "http://mcp-hub:8897/mcp" {
		t.Fatalf("unexpected mcp url: %v", mcps[0].Url)
	}
	if len(mcps[0].Headers) != 1 {
		t.Fatalf("expected one mcp header, got %d", len(mcps[0].Headers))
	}
	if mcps[0].Headers[0].Name != "Authorization" {
		t.Fatalf("expected Authorization header, got %s", mcps[0].Headers[0].Name)
	}
	if mcps[0].Headers[0].Value != "Bearer shared-token" {
		t.Fatalf("unexpected Authorization header value: %s", mcps[0].Headers[0].Value)
	}
}

func TestBuildMCPConfigsWithHubEnabledButEmptyURLFallback(t *testing.T) {
	taskID := uuid.New()
	uc := &TaskUsecase{
		cfg: &config.Config{
			MCPHub: config.MCPHub{
				Enabled: true,
				URL:     "",
				Token:   "shared-token",
			},
			Context7ApiKey: "context7-key",
		},
	}

	mcps := uc.buildMCPConfigs(taskID)
	if len(mcps) != 2 {
		t.Fatalf("expected fallback two mcp configs, got %d", len(mcps))
	}
	if mcps[0].Name != "mcaiBuiltin" {
		t.Fatalf("expected fallback first mcp name mcaiBuiltin, got %s", mcps[0].Name)
	}
	if mcps[1].Name != "context7" {
		t.Fatalf("expected fallback second mcp name context7, got %s", mcps[1].Name)
	}
}

func TestBuildMCPConfigsWithHubEnabledButEmptyTokenNoAuthHeader(t *testing.T) {
	taskID := uuid.New()
	uc := &TaskUsecase{
		cfg: &config.Config{
			MCPHub: config.MCPHub{
				Enabled: true,
				URL:     "http://mcp-hub:8897/mcp",
				Token:   "",
			},
			Context7ApiKey: "context7-key",
		},
	}

	mcps := uc.buildMCPConfigs(taskID)
	if len(mcps) != 1 {
		t.Fatalf("expected one mcp config, got %d", len(mcps))
	}
	if len(mcps[0].Headers) != 0 {
		t.Fatalf("expected no headers when token is empty, got %d", len(mcps[0].Headers))
	}
}

func TestBuildMCPConfigsWithHubDisabled(t *testing.T) {
	taskID := uuid.New()
	uc := &TaskUsecase{
		cfg: &config.Config{
			Context7ApiKey: "context7-key",
		},
	}

	mcps := uc.buildMCPConfigs(taskID)
	if len(mcps) != 2 {
		t.Fatalf("expected two mcp configs, got %d", len(mcps))
	}
	if mcps[0].Name != "mcaiBuiltin" {
		t.Fatalf("expected first mcp name mcaiBuiltin, got %s", mcps[0].Name)
	}
	if mcps[0].Type != "http" {
		t.Fatalf("expected first mcp type http, got %s", mcps[0].Type)
	}
	expectBuiltinURL := fmt.Sprintf("http://127.0.0.1:65510/mcp?task_id=%s", taskID.String())
	if mcps[0].Url == nil || *mcps[0].Url != expectBuiltinURL {
		t.Fatalf("unexpected mcaiBuiltin url: %v", mcps[0].Url)
	}
	if mcps[1].Name != "context7" {
		t.Fatalf("expected second mcp name context7, got %s", mcps[1].Name)
	}
	if mcps[1].Type != "http" {
		t.Fatalf("expected second mcp type http, got %s", mcps[1].Type)
	}
	if mcps[1].Url == nil || *mcps[1].Url != "https://mcp.context7.com/mcp" {
		t.Fatalf("unexpected context7 url: %v", mcps[1].Url)
	}
	if len(mcps[1].Headers) != 1 {
		t.Fatalf("expected one context7 header, got %d", len(mcps[1].Headers))
	}
	if mcps[1].Headers[0].Name != "CONTEXT7_API_KEY" {
		t.Fatalf("unexpected context7 header name: %s", mcps[1].Headers[0].Name)
	}
	if mcps[1].Headers[0].Value != "context7-key" {
		t.Fatalf("unexpected context7 header value: %s", mcps[1].Headers[0].Value)
	}
}
