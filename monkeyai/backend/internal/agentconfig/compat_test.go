package agentconfig

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func catalogRemote(t testing.TB) string {
	t.Helper()
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method == http.MethodDelete {
			w.WriteHeader(http.StatusOK)
			return
		}
		var in struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		result := resource.Object{}
		switch in.Method {
		case "initialize":
			result["protocolVersion"] = "2025-11-25"
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
			return
		case "tools/list":
			tools := []resource.Object{}
			for _, name := range []string{"tool0", "tool1", "visible", "disabled", "stale"} {
				tools = append(tools, resource.Object{"name": name, "description": "实时工具", "inputSchema": resource.Object{"type": "object"}})
			}
			result["tools"] = tools
		}
		resource.JSON(req.Context(), w, http.StatusOK, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	t.Cleanup(remote.Close)
	return remote.URL
}
