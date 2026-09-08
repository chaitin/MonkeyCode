package mcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
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
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			status = http.StatusRequestEntityTooLarge
		}
		rpcReply(w, status, nil, nil, &rpcError{Code: -32700, Message: "请求超限或不完整"})
		return in, false
	}
	if !json.Valid(body) {
		rpcReply(w, 400, nil, nil, &rpcError{Code: -32700, Message: "JSON 格式无效"})
		return in, false
	}
	if json.Unmarshal(body, &in) != nil || in.Version != "2.0" || in.Method == "" || !validID(in.ID) {
		rpcReply(w, 400, nil, nil, &rpcError{Code: -32600, Message: "JSON-RPC 请求无效"})
		return in, false
	}
	if len(in.Params) > 0 && !bytes.HasPrefix(bytes.TrimSpace(in.Params), []byte("{")) {
		rpcReply(w, 400, in.ID, nil, &rpcError{Code: -32602, Message: "参数必须为 JSON 对象"})
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

func rpcReply(w http.ResponseWriter, status int, id json.RawMessage, result any, err *rpcError) {
	out := map[string]any{"jsonrpc": "2.0", "id": id}
	if err != nil {
		out["error"] = err
	} else {
		out["result"] = result
	}
	resource.JSON(w, status, out)
}

func rpcFail(w http.ResponseWriter, id json.RawMessage, err error) {
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
	if references, ok := failure.References.(map[string]string); ok && references["transaction_id"] != "" {
		w.Header().Set("X-Billing-Transaction-ID", references["transaction_id"])
	}
	data, _ := json.Marshal(resource.Object{"code": failure.Code, "references": failure.References})
	rpcReply(w, failure.Status, id, nil, &rpcError{Code: -32000, Message: failure.Message, Data: data})
}
