package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestRPCFailuresPreserveProtocolAndLocalizedReason(t *testing.T) {
	r := httptest.NewRequest("POST", "/mcp/connectors/test", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rpcFail(r.Context(), w, json.RawMessage(`"call"`), &resource.Error{Status: 403, Code: "authorization_required", Message: "请先完成所选凭证的认证"})
	})).ServeHTTP(w, r)
	var body struct {
		ID    string `json:"id"`
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				Code string `json:"code"`
			} `json:"data"`
		} `json:"error"`
	}
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || w.Code != 403 || body.ID != "call" || body.Error.Code != -32000 || body.Error.Data.Code != "authorization_required" || !strings.Contains(body.Error.Message, "Authenticate the selected credential first") {
		t.Fatalf("JSON-RPC 错误结构或翻译错误: %s", w.Body.String())
	}
}
