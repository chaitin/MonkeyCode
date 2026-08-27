package domain

import (
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/db"
)

func TestTeamMCPUpstreamFromMasksHeaderValues(t *testing.T) {
	upstream := (&TeamMCPUpstream{}).From(&db.MCPUpstream{
		Headers: map[string]string{
			"Authorization": "Bearer secret",
			"X-Custom-Auth": "custom secret",
			"X-Empty":       "",
		},
		CreatedAt: time.Now(),
	})

	values := make(map[string]string, len(upstream.Headers))
	for _, header := range upstream.Headers {
		values[header.Name] = header.Value
	}
	if values["Authorization"] != MCPHeaderMask {
		t.Fatalf("Authorization = %q, want mask", values["Authorization"])
	}
	if values["X-Custom-Auth"] != MCPHeaderMask {
		t.Fatalf("X-Custom-Auth = %q, want mask", values["X-Custom-Auth"])
	}
	if values["X-Empty"] != "" {
		t.Fatalf("X-Empty = %q, want empty", values["X-Empty"])
	}
}
