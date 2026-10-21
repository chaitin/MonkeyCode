package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"io"
	"log/slog"
	"net/http"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const protocolVersion = "2025-11-25"

func supportedVersion(version string) bool {
	return slices.Contains([]string{"2024-11-05", "2025-03-26", "2025-06-18", protocolVersion}, version)
}

type request struct {
	Version string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func readRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	var in request
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		status := http.StatusBadRequest
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			status = http.StatusRequestEntityTooLarge
		}
		rpcReply(r.Context(), w, status, nil, nil, &rpcError{Code: -32700, Message: "请求超限或不完整"})
		return in, false
	}
	if !json.Valid(body) {
		rpcReply(r.Context(), w, 400, nil, nil, &rpcError{Code: -32700, Message: "JSON 格式无效"})
		return in, false
	}
	if json.Unmarshal(body, &in) != nil || in.Version != "2.0" || in.Method == "" || !validID(in.ID) {
		rpcReply(r.Context(), w, 400, nil, nil, &rpcError{Code: -32600, Message: "JSON-RPC 请求无效"})
		return in, false
	}
	if bytes.Equal(bytes.TrimSpace(in.Params), []byte("null")) {
		in.Params = nil
	}
	if len(in.Params) > 0 && !bytes.HasPrefix(bytes.TrimSpace(in.Params), []byte("{")) {
		rpcReply(r.Context(), w, 400, in.ID, nil, &rpcError{Code: -32602, Message: "参数必须为 JSON 对象"})
		return in, false
	}
	return in, true
}

func validID(id json.RawMessage) bool {
	if len(id) == 0 {
		return true
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(id))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return false
	}
	switch value.(type) {
	case string, json.Number:
		return true
	default:
		return false
	}
}

func rpcReply(ctx context.Context, w http.ResponseWriter, status int, id json.RawMessage, result any, err *rpcError) {
	out := map[string]any{"jsonrpc": "2.0", "id": id}
	if err != nil {
		out["error"] = err
	} else {
		out["result"] = result
	}
	resource.JSON(ctx, w, status, out)
}

func rpcFail(ctx context.Context, w http.ResponseWriter, id json.RawMessage, err error) {
	var failure *resource.Error
	var postgres *pgconn.PgError
	if !errors.As(err, &failure) {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			failure = resource.NotFound
		case errors.As(err, &postgres) && postgres.Code == "22P02":
			failure = &resource.Error{Status: 400, Code: "invalid_request", Message: "资源标识无效"}
		default:
			failure = &resource.Error{Status: 500, Code: "mcp_internal_error", Message: "MCP 请求处理失败"}
		}
	}
	if failure.Status >= 500 && !logging.Diagnosed(ctx) {
		logging.Diagnostic(ctx, slog.Default(), slog.LevelError, "mcp.request.failed", err, slog.String("module", "mcp"), slog.String("operation", "rpc"))
	} else if failure.Status < 500 {
		logging.Expected(ctx)
	}
	if references, ok := failure.References.(map[string]string); ok && references["transaction_id"] != "" {
		w.Header().Set("X-Billing-Transaction-ID", references["transaction_id"])
	}
	data, marshalErr := json.Marshal(resource.Object{"code": failure.Code, "references": failure.References})
	if marshalErr != nil {
		logging.Event(ctx, slog.Default(), slog.LevelError, "mcp.operation.error", "编码 MCP 错误响应失败", "module", "mcp", "operation", "rpcFail", "code", failure.Code, "error", marshalErr)
		data = nil
	}
	rpcReply(ctx, w, failure.Status, id, nil, &rpcError{Code: -32000, Message: failure.Message, Data: data})
}
