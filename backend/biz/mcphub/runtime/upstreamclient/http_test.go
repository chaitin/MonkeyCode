package upstreamclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

func TestListToolsPagination(t *testing.T) {
	for _, tc := range []struct {
		name, failure string
		pages         int
	}{
		{"single page", "", 1},
		{"multiple pages", "", 3},
		{"http failure", "http", 2},
		{"rpc failure", "rpc", 2},
		{"repeated cursor", "cursor", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			initialized, listed := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Method string `json:"method"`
					Params struct {
						Cursor string `json:"cursor"`
					} `json:"params"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch req.Method {
				case "initialize":
					initialized++
					w.Header().Set("Mcp-Session-Id", "test-session")
					fmt.Fprint(w, `{"jsonrpc":"2.0","id":"1","result":{}}`)
				case "notifications/initialized":
					w.WriteHeader(http.StatusAccepted)
				case "tools/list":
					listed++
					if r.Header.Get("Mcp-Session-Id") != "test-session" {
						t.Error("pagination did not preserve session")
					}
					expected := ""
					if listed > 1 {
						expected = fmt.Sprintf("page-%d", listed)
					}
					if req.Params.Cursor != expected {
						t.Errorf("cursor = %q, want %q", req.Params.Cursor, expected)
					}
					if listed > tc.pages {
						t.Error("unexpected extra page")
						http.Error(w, "extra page", 500)
						return
					}
					if listed == 2 {
						switch tc.failure {
						case "http":
							http.Error(w, "failed", 500)
							return
						case "rpc":
							fmt.Fprint(w, `{"error":{"code":-32603,"message":"failed"}}`)
							return
						}
					}
					cursor := ""
					if listed < tc.pages {
						cursor = fmt.Sprintf("page-%d", listed+1)
					}
					if tc.failure == "cursor" {
						cursor = "page-2"
					}
					// An empty intermediate page is legal and must not terminate discovery.
					tools := []map[string]any{}
					if listed != 2 || tc.pages != 3 {
						tools = append(tools, map[string]any{"name": fmt.Sprintf("tool-%d", listed)})
					}
					json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"tools": tools, "nextCursor": cursor}})
				default:
					t.Errorf("unexpected method %q", req.Method)
				}
			}))
			defer server.Close()
			tools, err := NewHTTPClient(time.Second, false).ListTools(context.Background(), &repo.UpstreamConfig{URL: server.URL})
			if tc.failure != "" {
				if err == nil || tools != nil {
					t.Fatalf("failure returned tools=%v, err=%v", tools, err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				want := tc.pages
				if tc.pages == 3 {
					want = 2
				}
				if len(tools) != want {
					t.Fatalf("got %d tools, want %d", len(tools), want)
				}
				for _, tool := range tools {
					if string(tool.InputSchema) != "{}" {
						t.Errorf("default schema = %s", tool.InputSchema)
					}
				}
			}
			if initialized != 1 || listed != tc.pages {
				t.Errorf("initialize=%d, pages=%d", initialized, listed)
			}
		})
	}
}
