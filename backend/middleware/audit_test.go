package middleware

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestMaskSensitiveDataMasksTeamMCPHeaders(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		body      string
	}{
		{
			name:      "创建",
			operation: "create_team_mcp_upstream",
			body:      `{"name":"private-mcp","headers":[{"name":"Authorization","value":"Bearer secret"},{"name":"X-Empty","value":""}]}`,
		},
		{
			name:      "更新",
			operation: "update_team_mcp_upstream",
			body:      `{"headers":[{"name":"X-Custom-Auth","value":"custom secret"}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			masked, _, err := maskSensitiveData(tt.operation, tt.body, "")
			if err != nil {
				t.Fatal(err)
			}
			var req struct {
				Headers []domain.MCPHeader `json:"headers"`
			}
			if err := json.Unmarshal([]byte(masked), &req); err != nil {
				t.Fatal(err)
			}
			for _, header := range req.Headers {
				if header.Value != "" && header.Value != domain.MCPHeaderMask {
					t.Fatalf("header %s leaked value %q", header.Name, header.Value)
				}
			}
		})
	}
}

func TestMaskSensitiveDataRedactsTeamRuleContent(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		req       string
		resp      string
	}{
		{
			name:      "create",
			operation: "add_team_rule",
			req:       `{"name":"sec","content":"secret-body"}`,
			resp:      `{"code":0,"data":{"id":"11111111-1111-1111-1111-111111111111","name":"sec","content":"secret-body"}}`,
		},
		{
			name:      "update",
			operation: "update_team_rule",
			req:       `{"content":"new-secret"}`,
			resp:      `{"code":0,"data":{"name":"sec","content":"new-secret","active_version":"20260909180000"}}`,
		},
		{
			name:      "restore",
			operation: "restore_team_rule",
			req:       `{"version_id":"22222222-2222-2222-2222-222222222222"}`,
			resp:      `{"code":0,"data":{"name":"sec","content":"old-secret"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, resp, err := maskSensitiveData(tt.operation, tt.req, tt.resp)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(req, "secret") {
				t.Fatalf("request leaked content: %s", req)
			}
			if strings.Contains(resp, "secret") {
				t.Fatalf("response leaked content: %s", resp)
			}
			if strings.Contains(tt.req, `"content"`) && !strings.Contains(req, "[redacted]") {
				t.Fatalf("request content was not redacted: %s", req)
			}
			if !strings.Contains(resp, "[redacted]") {
				t.Fatalf("response content was not redacted: %s", resp)
			}
			if !strings.Contains(resp, `"name":"sec"`) {
				t.Fatalf("response dropped non-content fields: %s", resp)
			}
		})
	}
}
