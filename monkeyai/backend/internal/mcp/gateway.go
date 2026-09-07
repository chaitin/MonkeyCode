package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type KeyAuthenticator interface {
	Authenticate(context.Context, string, string) (string, error)
}
type Invocation struct{ UserID, ConnectorID, ToolID, SessionID, IdempotencyKey, RequestHash string }
type InvocationResult struct {
	Known             bool
	Result, ErrorCode string
}
type InvocationBilling interface {
	Begin(context.Context, Invocation) (string, error)
	Start(context.Context, string) error
	Finish(context.Context, string, InvocationResult) error
}

func (s *Service) RegisterGateway(router chi.Router, keys KeyAuthenticator, billing InvocationBilling) {
	router.Post("/mcp/connectors/{id}", func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			resource.Fail(w, &resource.Error{Status: 401, Code: "invalid_key", Message: "缺少 MCP 调用密钥"})
			return
		}
		user, err := keys.Authenticate(r.Context(), strings.TrimSpace(token), "mcp:invoke")
		if err != nil {
			resource.Fail(w, &resource.Error{Status: 401, Code: "invalid_key", Message: "MCP 调用密钥无效或权限不足"})
			return
		}
		connector, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), user, false)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		var in struct {
			Version string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params"`
		}
		if err = resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		if in.Version != "2.0" {
			resource.Fail(w, resource.Invalid("JSON-RPC 版本无效"))
			return
		}
		respond := func(result any) {
			resource.JSON(w, 200, map[string]any{"jsonrpc": "2.0", "id": in.ID, "result": result})
		}
		switch in.Method {
		case "initialize":
			respond(map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]string{"name": "MonkeyAI", "version": "1"}})
			return
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "ping":
			respond(map[string]any{})
			return
		}
		tools, err := s.Tools(r.Context(), s.Store.Pool, connector, user, false)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if in.Method == "tools/list" {
			out := []map[string]any{}
			for _, tool := range tools {
				out = append(out, map[string]any{"name": tool["name"], "description": tool["description"], "inputSchema": tool["input_schema"]})
			}
			respond(map[string]any{"tools": out})
			return
		}
		if in.Method != "tools/call" {
			resource.JSON(w, 200, map[string]any{"jsonrpc": "2.0", "id": in.ID, "error": map[string]any{"code": -32601, "message": "不支持此方法"}})
			return
		}
		if len(in.ID) == 0 || string(in.ID) == "null" {
			resource.Fail(w, resource.Invalid("工具调用必须带请求 ID"))
			return
		}
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if json.Unmarshal(in.Params, &params) != nil || params.Name == "" {
			resource.Fail(w, resource.Invalid("工具参数无效"))
			return
		}
		var tool resource.Object
		for _, candidate := range tools {
			if candidate.String("name") == params.Name {
				tool = candidate
				break
			}
		}
		if tool == nil {
			resource.Fail(w, resource.NotFound)
			return
		}
		credential, err := s.Credential(r.Context(), s.Store.Pool, connector, user)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		headers := map[string]string{}
		if credential != nil {
			if connector.String("authorization_method") == "oauth" {
				headers["Authorization"] = "Bearer " + credential.String("oauth_access_token")
			} else {
				b, _ := json.Marshal(credential["http_headers"])
				if err = json.Unmarshal(b, &headers); err != nil {
					resource.Fail(w, err)
					return
				}
			}
		}
		remote, err := openRemote(r.Context(), connector.String("url"), headers)
		if err != nil {
			resource.Fail(w, &resource.Error{Status: 502, Code: "mcp_connect_failed", Message: "工具上游连接失败"})
			return
		}
		defer remote.http.CloseIdleConnections()
		id, err := billing.Begin(r.Context(), Invocation{UserID: user, ConnectorID: connector.String("id"), ToolID: tool.String("id"), SessionID: r.Header.Get("X-Session-ID"), IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestHash: resource.Hash(map[string]any{"connector": connector.String("id"), "params": params})})
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if err = billing.Start(r.Context(), id); err != nil {
			resource.Fail(w, err)
			return
		}
		w.Header().Set("X-Billing-Transaction-ID", id)
		result, callErr := remote.call(r.Context(), 2, "tools/call", params)
		outcome := InvocationResult{Known: true, Result: "succeeded"}
		var rpc *rpcError
		if callErr != nil {
			outcome.Result = "failed"
			outcome.ErrorCode = "mcp_call_failed"
			outcome.Known = errors.As(callErr, &rpc)
		} else {
			var body struct {
				IsError bool `json:"isError"`
			}
			if string(result) == "null" || json.Unmarshal(result, &body) != nil {
				outcome.Known = false
				outcome.Result = "failed"
				outcome.ErrorCode = "mcp_invalid_result"
			} else if body.IsError {
				outcome.Result = "failed"
				outcome.ErrorCode = "mcp_tool_error"
			}
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
		defer cancel()
		if err = billing.Finish(ctx, id, outcome); err != nil {
			w.Header().Set("X-Billing-Status", "pending")
		}
		if callErr != nil {
			resource.JSON(w, 200, map[string]any{"jsonrpc": "2.0", "id": in.ID, "error": map[string]any{"code": -32603, "message": "工具调用失败，可凭交易 ID 查询状态"}})
			return
		}
		respond(result)
	})
}
