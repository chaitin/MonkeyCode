package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/auth"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

var errUnauthorized = errors.New("unauthorized")

func (h *Handler) newHTTPHandler() http.Handler {
	hooks := &mcpserver.Hooks{}
	hooks.AddOnRequestInitialization(func(ctx context.Context, _ any, _ any) error {
		if _, ok := SubjectFromContext(ctx); !ok {
			return errUnauthorized
		}
		return h.syncSessionTools(ctx)
	})

	mcpSrv := mcpserver.NewMCPServer(
		"mcphub",
		"1.0.0",
		mcpserver.WithHooks(hooks),
		mcpserver.WithToolCapabilities(false),
	)
	mcpSrv.AddNotificationHandler("notifications/initialized", func(context.Context, mcp.JSONRPCNotification) {})

	transport := mcpserver.NewStreamableHTTPServer(mcpSrv)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subject, err := h.resolveSubject(r)
		if err != nil {
			h.logger.WarnContext(r.Context(), "mcphub request unauthorized", "http_method", r.Method, "path", r.URL.Path, "remote_addr", r.RemoteAddr)
			http.Error(w, errUnauthorized.Error(), http.StatusUnauthorized)
			return
		}

		ctx := WithSubject(r.Context(), subject)
		if r.Method == http.MethodPost {
			body, requestID, err := captureRequest(r.Body)
			if err == nil {
				ctx = WithRequestID(ctx, requestID)
			}
			if req, ok := decodeToolRequest(body); ok {
				if h.handleStatelessToolRequest(w, r.WithContext(ctx), subject, req) {
					return
				}
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
		}

		transport.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *Handler) resolveSubject(r *http.Request) (*auth.Subject, error) {
	if h.auth == nil {
		return nil, errUnauthorized
	}
	token, ok := extractBearerToken(r)
	if !ok {
		return nil, errUnauthorized
	}
	return h.auth.Resolve(r.Context(), token)
}

func captureRequest(body io.ReadCloser) ([]byte, any, error) {
	if body == nil {
		return nil, nil, nil
	}
	defer body.Close()

	data, err := io.ReadAll(body)
	if err != nil {
		return nil, nil, err
	}

	var payload struct {
		ID json.RawMessage `json:"id"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return data, nil, err
	}
	if len(payload.ID) == 0 {
		return data, nil, nil
	}

	var id any
	if err := json.Unmarshal(payload.ID, &id); err != nil {
		return data, nil, err
	}
	return data, id, nil
}

func (h *Handler) syncSessionTools(ctx context.Context) error {
	subject, ok := SubjectFromContext(ctx)
	if !ok {
		return errUnauthorized
	}
	session := mcpserver.ClientSessionFromContext(ctx)
	if session == nil {
		h.logger.WarnContext(ctx, "mcphub sync session tools skipped: missing session")
		return nil
	}
	sessionTools, ok := session.(mcpserver.SessionWithTools)
	if !ok {
		h.logger.WarnContext(ctx, "mcphub sync session tools skipped: session does not support tools", "session_id", session.SessionID())
		return nil
	}

	tools, err := h.buildServerTools(ctx, subject)
	if err != nil {
		h.logger.ErrorContext(ctx, "mcphub sync session tools failed", "session_id", session.SessionID(), "error", err)
		return err
	}

	toolMap := make(map[string]mcpserver.ServerTool, len(tools))
	for _, tool := range tools {
		toolMap[tool.Tool.Name] = tool
	}
	sessionTools.SetSessionTools(toolMap)
	return nil
}

type toolRequestEnvelope struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type statelessToolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func decodeToolRequest(body []byte) (toolRequestEnvelope, bool) {
	var req toolRequestEnvelope
	if err := json.Unmarshal(body, &req); err != nil {
		return toolRequestEnvelope{}, false
	}
	switch req.Method {
	case "tools/list", "tools/call":
		return req, true
	default:
		return toolRequestEnvelope{}, false
	}
}

func (h *Handler) handleStatelessToolRequest(w http.ResponseWriter, r *http.Request, subject *auth.Subject, req toolRequestEnvelope) bool {
	requestID, err := decodeRequestID(req.ID)
	if err != nil {
		writeJSONRPCError(w, mcp.NewRequestId(nil), mcp.INVALID_REQUEST, err.Error())
		return true
	}

	switch req.Method {
	case "tools/list":
		tools, err := h.listVisibleTools(r.Context(), subject)
		if err != nil {
			writeJSONRPCError(w, requestID, mcp.INTERNAL_ERROR, err.Error())
			return true
		}
		resultTools := make([]mcp.Tool, 0, len(tools))
		for _, tool := range tools {
			resultTools = append(resultTools, mcp.NewToolWithRawSchema(tool.NamespacedName, tool.Description, tool.InputSchema))
		}
		writeJSONRPCResult(w, requestID, mcp.NewListToolsResult(resultTools, ""))
		return true
	case "tools/call":
		var params statelessToolCallParams
		if len(req.Params) > 0 {
			if err := json.Unmarshal(req.Params, &params); err != nil {
				writeJSONRPCError(w, requestID, mcp.INVALID_PARAMS, "invalid tools/call params")
				return true
			}
		}

		tool, err := h.findVisibleTool(r.Context(), subject, params.Name)
		if err != nil {
			writeJSONRPCError(w, requestID, classifyToolRequestError(err), err.Error())
			return true
		}

		result, err := h.handleToolCallRequest(r.Context(), subject, *tool, mcp.CallToolRequest{
			Request: mcp.Request{Method: req.Method},
			Params: mcp.CallToolParams{
				Name:      params.Name,
				Arguments: json.RawMessage(params.Arguments),
			},
		})
		if err != nil {
			writeJSONRPCError(w, requestID, classifyToolRequestError(err), err.Error())
			return true
		}
		writeJSONRPCResult(w, requestID, result)
		return true
	default:
		return false
	}
}

func (h *Handler) findVisibleTool(ctx context.Context, subject *auth.Subject, name string) (*repo.ToolSnapshot, error) {
	tools, err := h.listVisibleTools(ctx, subject)
	if err != nil {
		return nil, err
	}
	for _, tool := range tools {
		if tool.NamespacedName == name {
			toolCopy := tool
			return &toolCopy, nil
		}
	}
	return nil, errors.New("tool not found")
}

func decodeRequestID(raw json.RawMessage) (mcp.RequestId, error) {
	if len(raw) == 0 {
		return mcp.NewRequestId(nil), nil
	}
	var id mcp.RequestId
	if err := json.Unmarshal(raw, &id); err != nil {
		return mcp.NewRequestId(nil), err
	}
	return id, nil
}

func classifyToolRequestError(err error) int {
	if err == nil {
		return 0
	}
	if repo.IsUpstreamNotFound(err) || err.Error() == "tool not found" {
		return mcp.INVALID_PARAMS
	}
	return mcp.INTERNAL_ERROR
}

func writeJSONRPCResult(w http.ResponseWriter, id mcp.RequestId, result any) {
	writeJSONRPC(w, http.StatusOK, mcp.JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	})
}

func writeJSONRPCError(w http.ResponseWriter, id mcp.RequestId, code int, message string) {
	resp := mcp.JSONRPCError{
		JSONRPC: "2.0",
		ID:      id,
	}
	resp.Error.Code = code
	resp.Error.Message = message
	writeJSONRPC(w, http.StatusOK, resp)
}

func writeJSONRPC(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
