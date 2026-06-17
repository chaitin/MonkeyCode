package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/auth"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

type toolRegistry interface {
	ListEffectiveTools(ctx context.Context, userID uuid.UUID) ([]repo.ToolSnapshot, error)
}

type authResolver interface {
	Resolve(ctx context.Context, token string) (*auth.Subject, error)
}

type toolCallStore interface {
	GetByRequestID(ctx context.Context, requestID string) (*repo.ToolCallRecord, bool, error)
	CreatePending(ctx context.Context, req repo.CreatePendingCall) (*repo.ToolCallRecord, error)
	MarkSuccess(ctx context.Context, id uuid.UUID, result json.RawMessage, upstreamRequestID string) error
	MarkFailed(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error
	MarkUnknown(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error
}

type upstreamReader interface {
	Get(ctx context.Context, id uuid.UUID) (*repo.UpstreamConfig, error)
}

type upstreamCaller interface {
	CallTool(ctx context.Context, upstream *repo.UpstreamConfig, tool repo.ToolSnapshot, params CallToolParams) (json.RawMessage, string, error)
}

type callConsumer interface {
	CanConsume(ctx context.Context, call *repo.ToolCallRecord) error
	Consume(ctx context.Context, call *repo.ToolCallRecord) error
}

type Option func(*Handler)

type Handler struct {
	registry  toolRegistry
	auth      authResolver
	calls     toolCallStore
	upstreams upstreamReader
	upstream  upstreamCaller
	billing   callConsumer
	http      http.Handler
	logger    *slog.Logger
}

type CallToolParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func NewHandler(registry toolRegistry, opts ...Option) *Handler {
	h := &Handler{registry: registry, logger: slog.Default()}
	for _, opt := range opts {
		opt(h)
	}
	if h.logger == nil {
		h.logger = slog.Default()
	}
	h.http = h.newHTTPHandler()
	return h
}

func WithAuthResolver(resolver authResolver) Option {
	return func(h *Handler) {
		h.auth = resolver
	}
}

func WithToolCallStore(store toolCallStore) Option {
	return func(h *Handler) {
		h.calls = store
	}
}

func WithUpstreamRepo(repo upstreamReader) Option {
	return func(h *Handler) {
		h.upstreams = repo
	}
}

func WithUpstreamCaller(caller upstreamCaller) Option {
	return func(h *Handler) {
		h.upstream = caller
	}
}

func WithBillingConsumer(consumer callConsumer) Option {
	return func(h *Handler) {
		h.billing = consumer
	}
}

func WithLogger(logger *slog.Logger) Option {
	return func(h *Handler) {
		h.logger = logger
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.http == nil {
		http.Error(w, "handler not initialized", http.StatusInternalServerError)
		return
	}
	h.http.ServeHTTP(w, r)
}

func (h *Handler) buildServerTools(ctx context.Context, subject *auth.Subject) ([]mcpserver.ServerTool, error) {
	tools, err := h.listVisibleTools(ctx, subject)
	if err != nil {
		return nil, err
	}

	result := make([]mcpserver.ServerTool, 0, len(tools))
	for _, tool := range tools {
		snapshot := tool
		result = append(result, mcpserver.ServerTool{
			Tool: mcp.NewToolWithRawSchema(snapshot.NamespacedName, snapshot.Description, snapshot.InputSchema),
			Handler: func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				return h.handleToolCallRequest(ctx, subject, snapshot, req)
			},
		})
	}
	return result, nil
}

func (h *Handler) listVisibleTools(ctx context.Context, subject *auth.Subject) ([]repo.ToolSnapshot, error) {
	tools, err := h.registry.ListEffectiveTools(ctx, subject.UserID)
	if err != nil {
		h.logger.ErrorContext(ctx, "mcphub list effective tools failed", "user_id", subject.UserID, "task_id", subject.TaskID, "error", err)
		return nil, err
	}
	filtered, err := h.filterReachableTools(ctx, tools)
	if err != nil {
		h.logger.ErrorContext(ctx, "mcphub filter reachable tools failed", "user_id", subject.UserID, "task_id", subject.TaskID, "tools", len(tools), "error", err)
		return nil, err
	}
	h.logger.InfoContext(ctx, "mcphub resolved visible tools", "user_id", subject.UserID, "task_id", subject.TaskID, "tools", len(filtered))
	return filtered, nil
}

func (h *Handler) filterReachableTools(ctx context.Context, tools []repo.ToolSnapshot) ([]repo.ToolSnapshot, error) {
	if h.upstreams == nil {
		return tools, nil
	}

	filtered := make([]repo.ToolSnapshot, 0, len(tools))
	for _, tool := range tools {
		if tool.UpstreamID == uuid.Nil {
			filtered = append(filtered, tool)
			continue
		}
		upstream, err := h.upstreams.Get(ctx, tool.UpstreamID)
		if err != nil {
			if repo.IsUpstreamNotFound(err) {
				h.logger.WarnContext(ctx, "mcphub skip tool with missing upstream", "tool", tool.NamespacedName, "upstream_id", tool.UpstreamID)
				continue
			}
			return nil, err
		}
		if upstream != nil && !upstream.Enabled {
			h.logger.InfoContext(ctx, "mcphub skip tool with disabled upstream", "tool", tool.NamespacedName, "upstream_id", tool.UpstreamID)
			continue
		}
		filtered = append(filtered, tool)
	}
	return filtered, nil
}

func (h *Handler) handleToolCallRequest(ctx context.Context, subject *auth.Subject, tool repo.ToolSnapshot, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if h.calls == nil || h.upstreams == nil || h.upstream == nil {
		return nil, errors.New("method not found")
	}

	args, err := marshalArguments(req.Params.Arguments)
	if err != nil {
		return nil, err
	}

	requestID := BuildRequestID(subject, RequestIDFromContext(ctx), req.Params.Name, args)
	h.logger.InfoContext(ctx, "mcphub tool call started", "tool", req.Params.Name, "user_id", subject.UserID, "task_id", subject.TaskID, "request_id", requestID)
	if existing, ok, err := h.calls.GetByRequestID(ctx, requestID); err != nil {
		return nil, err
	} else if ok {
		return existingCallResult(existing)
	}

	upstream, err := h.upstreams.Get(ctx, tool.UpstreamID)
	if err != nil {
		return nil, err
	}
	if !upstream.Enabled {
		return nil, errors.New("tool not found")
	}

	call, err := h.calls.CreatePending(ctx, repo.CreatePendingCall{
		RequestID:         requestID,
		TaskID:            subject.TaskID,
		UserID:            subject.UserID,
		UpstreamID:        tool.UpstreamID,
		ToolID:            tool.ID,
		ToolNameSnapshot:  tool.NamespacedName,
		ToolScopeSnapshot: tool.Scope,
		PriceSnapshot:     tool.Price,
		ArgsJSON:          args,
	})
	if err != nil {
		return nil, err
	}

	if h.billing != nil {
		if err := h.billing.CanConsume(ctx, call); err != nil {
			_ = h.calls.MarkFailed(ctx, call.ID, err.Error(), "")
			return nil, err
		}
	}

	result, upstreamRequestID, err := h.upstream.CallTool(ctx, upstream, tool, CallToolParams{
		Name:      tool.Name,
		Arguments: args,
	})
	switch classifyUpstreamError(err) {
	case repo.ToolCallStatusSuccess:
		if err := h.calls.MarkSuccess(ctx, call.ID, result, upstreamRequestID); err != nil {
			return nil, err
		}
		if h.billing != nil {
			completed := *call
			completed.Status = repo.ToolCallStatusSuccess
			completed.ResultJSON = result
			completed.UpstreamRequestID = upstreamRequestID
			if err := h.billing.Consume(ctx, &completed); err != nil {
				return nil, err
			}
		}
		return decodeCallToolResult(result)
	case repo.ToolCallStatusFailed:
		_ = h.calls.MarkFailed(ctx, call.ID, err.Error(), upstreamRequestID)
		return nil, err
	default:
		_ = h.calls.MarkUnknown(ctx, call.ID, err.Error(), upstreamRequestID)
		return nil, errors.New("upstream result unknown")
	}
}

func BuildRequestID(subject *auth.Subject, reqID any, tool string, args json.RawMessage) string {
	base := subject.TaskID.String() + ":" + stringifyRequestID(reqID) + ":" + tool + ":" + string(canonicalJSON(args))
	sum := sha256.Sum256([]byte(base))
	return hex.EncodeToString(sum[:16])
}

func decodeCallToolResult(raw json.RawMessage) (*mcp.CallToolResult, error) {
	var result mcp.CallToolResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func existingCallResult(record *repo.ToolCallRecord) (*mcp.CallToolResult, error) {
	switch record.Status {
	case repo.ToolCallStatusSuccess:
		return decodeCallToolResult(record.ResultJSON)
	case repo.ToolCallStatusFailed:
		return nil, errors.New(record.ErrorMessage)
	default:
		return nil, errors.New("upstream result unknown")
	}
}

func marshalArguments(args any) (json.RawMessage, error) {
	if args == nil {
		return json.RawMessage(`{}`), nil
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	return canonicalJSON(raw), nil
}

func canonicalJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return raw
	}

	b, err := json.Marshal(value)
	if err != nil {
		return raw
	}
	return json.RawMessage(b)
}

func stringifyRequestID(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func extractBearerToken(r *http.Request) (string, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}
	return token, true
}

func classifyUpstreamError(err error) repo.ToolCallStatus {
	if err == nil {
		return repo.ToolCallStatusSuccess
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return repo.ToolCallStatusUnknown
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return repo.ToolCallStatusUnknown
	}
	return repo.ToolCallStatusFailed
}
