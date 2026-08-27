package middleware

import (
	"encoding/json"
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
