package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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
	router.HandleFunc("/mcp/connectors/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if origin := r.Header.Get("Origin"); origin != "" {
			provided, err := url.Parse(origin)
			public, _ := url.Parse(s.PublicURL)
			if err != nil || public == nil || provided.User != nil || provided.Path != "" || provided.RawQuery != "" || provided.Fragment != "" || !strings.EqualFold(provided.Scheme, public.Scheme) || !strings.EqualFold(provided.Host, public.Host) {
				rpcFail(w, nil, &resource.Error{Status: 403, Code: "invalid_origin", Message: "请求来源不被允许"})
				return
			}
		}
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp"`)
			rpcFail(w, nil, &resource.Error{Status: 401, Code: "invalid_key", Message: "缺少 MCP 调用密钥"})
			return
		}
		user, err := keys.Authenticate(r.Context(), strings.TrimSpace(token), "mcp:invoke")
		if err != nil {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp", error="invalid_token"`)
			rpcFail(w, nil, &resource.Error{Status: 401, Code: "invalid_key", Message: "MCP 调用密钥无效或权限不足"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			rpcFail(w, nil, &resource.Error{Status: 415, Code: "invalid_content_type", Message: "请求须使用 application/json"})
			return
		}
		if version := r.Header.Get("MCP-Protocol-Version"); version != "" && !supportedVersion(version) {
			rpcFail(w, nil, &resource.Error{Status: 400, Code: "unsupported_protocol", Message: "MCP 协议版本不支持"})
			return
		}
		in, ok := readRequest(w, r)
		if !ok {
			return
		}
		connector, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), user, false)
		if err != nil {
			rpcFail(w, in.ID, err)
			return
		}
		if strings.HasPrefix(in.Method, "notifications/") {
			if len(in.ID) != 0 {
				rpcReply(w, 400, in.ID, nil, &rpcError{Code: -32600, Message: "通知不能包含请求 ID"})
				return
			}
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if len(in.ID) == 0 {
			// 无 ID 的消息不执行工具，也不产生 JSON-RPC 响应。
			w.WriteHeader(http.StatusAccepted)
			return
		}
		switch in.Method {
		case "initialize":
			var params struct {
				Version string `json:"protocolVersion"`
			}
			if json.Unmarshal(in.Params, &params) != nil || params.Version == "" {
				rpcReply(w, 200, in.ID, nil, &rpcError{Code: -32602, Message: "缺少 MCP 协议版本"})
				return
			}
			if !supportedVersion(params.Version) {
				params.Version = protocolVersion
			}
			rpcReply(w, 200, in.ID, resource.Object{"protocolVersion": params.Version, "capabilities": resource.Object{"tools": resource.Object{}}, "serverInfo": resource.Object{"name": "MonkeyAI", "version": "1"}}, nil)
		case "ping":
			rpcReply(w, 200, in.ID, resource.Object{}, nil)
		case "tools/list", "tools/call":
			s.invoke(w, r, in, connector, user, billing)
		default:
			rpcReply(w, 200, in.ID, nil, &rpcError{Code: -32601, Message: "不支持此方法"})
		}
	})
}

func (s *Service) invoke(w http.ResponseWriter, r *http.Request, in request, connector resource.Object, user string, billing InvocationBilling) {
	credential, err := s.Credential(r.Context(), s.Store.Pool, connector, user)
	if errors.Is(err, pgx.ErrNoRows) {
		err = &resource.Error{Status: 403, Code: "authorization_required", Message: "请先完成连接认证"}
	}
	if err != nil {
		rpcFail(w, in.ID, err)
		return
	}
	headers := map[string]string{}
	if credential != nil {
		if credential.String("method") == "oauth" {
			credential, err = s.refresh(r.Context(), connector, credential)
			if err != nil {
				rpcFail(w, in.ID, &resource.Error{Status: 403, Code: "authorization_required", Message: "OAuth 已失效，请重新授权"})
				return
			}
			headers["Authorization"] = "Bearer " + credential.String("oauth_access_token")
		} else {
			body, _ := json.Marshal(credential["http_headers"])
			if err = json.Unmarshal(body, &headers); err != nil {
				rpcFail(w, in.ID, err)
				return
			}
		}
	}
	tools, err := credentialTools(r.Context(), s.Store.Pool, connector, credential, false)
	if err != nil {
		rpcFail(w, in.ID, err)
		return
	}
	if in.Method == "tools/list" {
		var params struct {
			Cursor string `json:"cursor"`
		}
		if len(in.Params) > 0 && (json.Unmarshal(in.Params, &params) != nil || params.Cursor != "") {
			rpcReply(w, 200, in.ID, nil, &rpcError{Code: -32602, Message: "工具目录游标无效"})
			return
		}
		out := []resource.Object{}
		for _, tool := range tools {
			out = append(out, resource.Object{"name": tool["name"], "description": tool["description"], "inputSchema": tool["input_schema"]})
		}
		rpcReply(w, 200, in.ID, resource.Object{"tools": out}, nil)
		return
	}
	var params map[string]any
	decoder := json.NewDecoder(bytes.NewReader(in.Params))
	decoder.UseNumber()
	err = decoder.Decode(&params)
	name, _ := params["name"].(string)
	arguments, hasArguments := params["arguments"]
	_, objectArguments := arguments.(map[string]any)
	if err != nil || name == "" || (hasArguments && !objectArguments) {
		rpcReply(w, 200, in.ID, nil, &rpcError{Code: -32602, Message: "工具参数无效"})
		return
	}
	var tool resource.Object
	for _, candidate := range tools {
		if candidate.String("name") == name {
			tool = candidate
			break
		}
	}
	if tool == nil {
		rpcReply(w, 200, in.ID, nil, &rpcError{Code: -32602, Message: "工具不存在或未启用"})
		return
	}
	remote, err := openRemote(r.Context(), connector.String("url"), headers)
	if err != nil {
		rpcFail(w, in.ID, &resource.Error{Status: 502, Code: "mcp_connect_failed", Message: "工具上游连接失败"})
		return
	}
	defer remote.close()
	id, err := billing.Begin(r.Context(), Invocation{UserID: user, ConnectorID: connector.String("id"), ToolID: tool.String("id"), SessionID: r.Header.Get("X-Session-ID"), IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestHash: resource.Hash(resource.Object{"connector": connector.String("id"), "params": params, "session_id": r.Header.Get("X-Session-ID")})})
	if err != nil {
		rpcFail(w, in.ID, err)
		return
	}
	w.Header().Set("X-Billing-Transaction-ID", id)
	if err = billing.Start(r.Context(), id); err != nil {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
		defer cancel()
		if billing.Finish(ctx, id, InvocationResult{Known: true, Result: "failed", ErrorCode: "mcp_not_started"}) != nil {
			w.Header().Set("X-Billing-Status", "pending")
		}
		rpcFail(w, in.ID, err)
		return
	}
	result, callErr := remote.call(r.Context(), 2, "tools/call", in.Params)
	outcome := InvocationResult{Known: true, Result: "succeeded"}
	var rpc *rpcError
	if callErr != nil {
		outcome.Result = "failed"
		outcome.ErrorCode = "mcp_call_failed"
		outcome.Known = errors.As(callErr, &rpc)
	} else {
		var body struct {
			Content []json.RawMessage `json:"content"`
			IsError bool              `json:"isError"`
		}
		if json.Unmarshal(result, &body) != nil || body.Content == nil {
			outcome.Known = false
			outcome.Result = "failed"
			outcome.ErrorCode = "mcp_invalid_result"
			callErr = errors.New("MCP 工具结果无效")
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
		code := -32603
		if rpc != nil {
			code = rpc.Code
		}
		rpcReply(w, 200, in.ID, nil, &rpcError{Code: code, Message: "工具调用失败，可凭交易 ID 查询状态"})
		return
	}
	rpcReply(w, 200, in.ID, result, nil)
}
