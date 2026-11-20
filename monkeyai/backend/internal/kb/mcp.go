package kb

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/go-chi/chi/v5"
)

const kbMCPProtocolVersion = "2025-11-25"

type MCPKeyAuthenticator interface {
	Authenticate(context.Context, string, string) (string, error)
}

type mcpRequest struct {
	Version string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type mcpError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (s *Service) RegisterMCP(router chi.Router, keys MCPKeyAuthenticator) {
	router.Post("/mcp/kb", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp"`)
			writeMCPReply(r.Context(), w, http.StatusUnauthorized, nil, nil, &mcpError{Code: -32000, Message: "缺少 MCP 调用密钥", Data: json.RawMessage(`{"code":"invalid_key"}`)})
			return
		}
		userID, err := keys.Authenticate(r.Context(), strings.TrimSpace(token), "mcp:invoke")
		if err != nil {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp", error="invalid_token"`)
			writeMCPReply(r.Context(), w, http.StatusUnauthorized, nil, nil, &mcpError{Code: -32000, Message: "MCP 调用密钥无效或权限不足", Data: json.RawMessage(`{"code":"invalid_key"}`)})
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			writeMCPReply(r.Context(), w, http.StatusUnsupportedMediaType, nil, nil, &mcpError{Code: -32600, Message: "请求须使用 application/json"})
			return
		}
		if version := r.Header.Get("MCP-Protocol-Version"); version != "" && !supportedKBProtocolVersion(version) {
			writeMCPReply(r.Context(), w, http.StatusBadRequest, nil, nil, &mcpError{Code: -32600, Message: "MCP 协议版本不支持"})
			return
		}
		request, ok := readMCPRequest(w, r)
		if !ok {
			return
		}
		if strings.HasPrefix(request.Method, "notifications/") {
			if len(request.ID) != 0 {
				writeMCPReply(r.Context(), w, http.StatusBadRequest, request.ID, nil, &mcpError{Code: -32600, Message: "通知不能包含请求 ID"})
				return
			}
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if len(request.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		switch request.Method {
		case "initialize":
			var params struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			if json.Unmarshal(request.Params, &params) != nil || params.ProtocolVersion == "" {
				writeMCPReply(r.Context(), w, http.StatusOK, request.ID, nil, &mcpError{Code: -32602, Message: "缺少 MCP 协议版本"})
				return
			}
			version := params.ProtocolVersion
			if !supportedKBProtocolVersion(version) {
				version = kbMCPProtocolVersion
			}
			writeMCPReply(r.Context(), w, http.StatusOK, request.ID, resource.Object{
				"protocolVersion": version,
				"capabilities":    resource.Object{"tools": resource.Object{}},
				"serverInfo":      resource.Object{"name": "baizhi-office-kb", "version": "1"},
			}, nil)
		case "ping":
			writeMCPReply(r.Context(), w, http.StatusOK, request.ID, resource.Object{}, nil)
		case "tools/list":
			writeMCPReply(r.Context(), w, http.StatusOK, request.ID, resource.Object{"tools": MCPTools()}, nil)
		case "tools/call":
			result, err := s.callMCPTool(r.Context(), userID, request.Params)
			if err != nil {
				writeMCPToolError(r.Context(), w, request.ID, err)
				return
			}
			writeMCPReply(r.Context(), w, http.StatusOK, request.ID, result, nil)
		default:
			writeMCPReply(r.Context(), w, http.StatusOK, request.ID, nil, &mcpError{Code: -32601, Message: "不支持此方法"})
		}
	})
}

func (s *Service) callMCPTool(ctx context.Context, userID string, params json.RawMessage) (resource.Object, error) {
	var call struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	decoder := json.NewDecoder(bytes.NewReader(params))
	decoder.UseNumber()
	if err := decoder.Decode(&call); err != nil || call.Name == "" {
		return nil, resource.Invalid("工具参数无效")
	}
	if call.Arguments == nil {
		call.Arguments = map[string]any{}
	}
	var payload any
	switch call.Name {
	case "kb_edit_document":
		item, err := s.editMCPDocument(ctx, userID, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = item
	case "kb_read_document":
		item, err := s.readMCPDocument(ctx, userID, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = item
	case "kb_get", "kb_list_tags", "kb_list_permissions":
		item, err := s.readMCPKnowledgeBase(ctx, userID, call.Name, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = item
	case "kb_get_image":
		return s.readMCPImage(ctx, userID, call.Arguments)
	case "kb_update":
		item, err := s.updateMCPKnowledgeBase(ctx, userID, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = item
	case "kb_move_document", "kb_restudy_document":
		item, err := s.writeMCPDocument(ctx, userID, call.Name, call.Arguments)
		if err != nil {
			return nil, err
		}
		if _, batch := call.Arguments["ids"]; batch {
			payload = item
		} else {
			payload = publicDocument(item)
		}
	case "kb_upload_image":
		item, err := s.uploadMCPImage(ctx, userID, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = item
	case "kb_create":
		input, err := mcpCreateKnowledgeBaseInput(call.Arguments)
		if err != nil {
			return nil, err
		}
		item, err := s.CreateUserKB(ctx, userID, input)
		if err != nil {
			return nil, err
		}
		payload = publicKBDetail(item, userID)
	case "kb_list":
		result, err := s.mcpListKnowledgeBases(ctx, userID, call.Arguments)
		if err != nil {
			return nil, err
		}
		payload = result
	case "kb_search":
		data, err := json.Marshal(call.Arguments)
		if err != nil {
			return nil, resource.Invalid("工具参数无效")
		}
		var input SearchInput
		if err := json.Unmarshal(data, &input); err != nil {
			return nil, resource.Invalid("检索参数无效")
		}
		response, err := s.SearchLearnedWithResponse(ctx, userID, input)
		if err != nil {
			return nil, err
		}
		payload = response
	case "kb_list_documents":
		kbID, filter, err := mcpDocumentListFilter(call.Arguments)
		if err != nil {
			return nil, err
		}
		result, err := s.ListAccessibleDocuments(ctx, userID, kbID, filter)
		if err != nil {
			return nil, err
		}
		payload = result
	case "kb_get_document":
		kbID, err := mcpRequiredString(call.Arguments, "kb_id")
		if err != nil {
			return nil, err
		}
		documentID, err := mcpRequiredString(call.Arguments, "document_id")
		if err != nil {
			return nil, err
		}
		includeContent, _ := call.Arguments["include_content"].(bool)
		item, err := s.GetAccessibleDocumentInKB(ctx, userID, kbID, documentID)
		if err != nil {
			return nil, err
		}
		out := publicDocument(item)
		if !includeContent {
			delete(out, "content")
		}
		payload = publicDocument(out)
	case "kb_create_folder":
		input, err := mcpFolderInput(call.Arguments)
		if err != nil {
			return nil, err
		}
		item, err := s.CreateUserDocument(ctx, userID, input)
		if err != nil {
			return nil, err
		}
		payload = publicDocument(item)
	case "kb_create_document":
		input, err := mcpDocumentInput(call.Arguments)
		if err != nil {
			return nil, err
		}
		item, err := s.CreateUserDocument(ctx, userID, input)
		if err != nil {
			return nil, err
		}
		payload = publicDocument(item)
	case "kb_update_document":
		kbID, err := mcpRequiredString(call.Arguments, "kb_id")
		if err != nil {
			return nil, err
		}
		documentID, err := mcpRequiredString(call.Arguments, "document_id")
		if err != nil {
			return nil, err
		}
		if !mcpDocumentUpdateProvided(call.Arguments) {
			return nil, resource.Invalid("至少需要一个可更新字段")
		}
		input, err := mcpDocumentInput(call.Arguments)
		if err != nil {
			return nil, err
		}
		if _, err := s.GetAccessibleDocumentInKB(ctx, userID, kbID, documentID); err != nil {
			return nil, err
		}
		item, err := s.UpdateUserDocument(ctx, userID, documentID, input)
		if err != nil {
			return nil, err
		}
		payload = publicDocument(item)
	case "kb_delete_document":
		if _, ok := call.Arguments["ids"]; ok {
			result, err := s.writeMCPDocuments(ctx, userID, call.Name, call.Arguments)
			if err != nil {
				return nil, err
			}
			payload = result
			break
		}

		kbID, err := mcpRequiredString(call.Arguments, "kb_id")
		if err != nil {
			return nil, err
		}
		documentID, err := mcpRequiredString(call.Arguments, "document_id")
		if err != nil {
			return nil, err
		}
		if _, err := s.GetAccessibleDocumentInKB(ctx, userID, kbID, documentID); err != nil {
			return nil, err
		}
		input, err := mcpDocumentInput(call.Arguments)
		if err != nil {
			return nil, err
		}
		if err := s.deleteDocument(ctx, documentID, userID, input.ExpectedRevision); err != nil {
			return nil, err
		}
		payload = resource.Object{"id": documentID, "deleted": true}
	default:
		return nil, resource.Invalid("未知工具")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return resource.Object{
		"content":           []any{resource.Object{"type": "text", "text": string(data)}},
		"structuredContent": payload,
	}, nil
}

func (s *Service) mcpListKnowledgeBases(ctx context.Context, userID string, arguments map[string]any) (resource.Object, error) {
	filter, page, size, tagIDs, err := mcpKBListInput(arguments)
	if err != nil {
		return nil, err
	}
	payload, err := s.listKnowledgeBasePage(ctx, userID, filter, tagIDs, page, size)
	if err != nil {
		return nil, err
	}
	payload["version"] = resource.Hash(payload)
	return resource.Object(payload), nil
}

func mcpKBListInput(arguments map[string]any) (resource.CatalogFilter, int, int, []string, error) {
	data, err := json.Marshal(arguments)
	if err != nil {
		return resource.CatalogFilter{}, 0, 0, nil, resource.Invalid("知识库列表参数无效")
	}
	var input struct {
		Query    string   `json:"q"`
		Owner    string   `json:"owner"`
		TagID    string   `json:"tag_id"`
		TagIDs   []string `json:"tag_ids"`
		Page     *int     `json:"page"`
		PageSize *int     `json:"page_size"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return resource.CatalogFilter{}, 0, 0, nil, resource.Invalid("知识库列表参数无效")
	}
	filter, err := resource.NewCatalogFilter(input.Owner, input.Query)
	if err != nil {
		return resource.CatalogFilter{}, 0, 0, nil, err
	}
	page, size := 1, documentDefaultPageSize
	if input.Page != nil {
		page = *input.Page
	}
	if input.PageSize != nil {
		size = *input.PageSize
	}
	if page, size, err = resource.PageValuesWithLimit(page, size, documentMaxPageSize); err != nil {
		return resource.CatalogFilter{}, 0, 0, nil, err
	}
	return filter, page, size, mcpTagIDs(append([]string{input.TagID}, input.TagIDs...)...), nil
}

func mcpTagIDs(values ...string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		for part := range strings.SplitSeq(value, ",") {
			id := strings.TrimSpace(part)
			if id != "" && !seen[id] {
				out = append(out, id)
				seen[id] = true
			}
		}
	}
	return out
}

func mcpRequiredString(arguments map[string]any, key string) (string, error) {
	value, _ := arguments[key].(string)
	value = strings.TrimSpace(value)
	if value == "" {
		return "", resource.Invalid(key + " 不能为空")
	}
	return value, nil
}

func mcpDocumentListFilter(arguments map[string]any) (string, DocumentListFilter, error) {
	data, err := json.Marshal(arguments)
	if err != nil {
		return "", DocumentListFilter{}, resource.Invalid("文档列表参数无效")
	}
	var input struct {
		KbID       string `json:"kb_id"`
		Query      string `json:"q"`
		Status     string `json:"status"`
		SourceType string `json:"source_type"`
		Page       int    `json:"page"`
		PageSize   int    `json:"page_size"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return "", DocumentListFilter{}, resource.Invalid("文档列表参数无效")
	}
	kbID := strings.TrimSpace(input.KbID)
	if kbID == "" {
		return "", DocumentListFilter{}, resource.Invalid("kb_id 不能为空")
	}
	return kbID, DocumentListFilter{
		Query:      input.Query,
		Status:     input.Status,
		SourceType: input.SourceType,
		Page:       input.Page,
		PageSize:   input.PageSize,
	}, nil
}

func mcpDocumentInput(arguments map[string]any) (DocumentInput, error) {
	data, err := json.Marshal(arguments)
	if err != nil {
		return DocumentInput{}, resource.Invalid("文档参数无效")
	}
	var input DocumentInput
	if err := json.Unmarshal(data, &input); err != nil {
		return DocumentInput{}, resource.Invalid("文档参数无效")
	}
	return input, nil
}

func mcpDocumentUpdateProvided(arguments map[string]any) bool {
	for _, key := range []string{"title", "source_type", "content", "file_name", "mime_type", "size_bytes"} {
		if _, ok := arguments[key]; ok {
			return true
		}
	}
	return false
}

func supportedKBProtocolVersion(version string) bool {
	return slices.Contains([]string{"2024-11-05", "2025-03-26", "2025-06-18", kbMCPProtocolVersion}, version)
}

func readMCPRequest(w http.ResponseWriter, r *http.Request) (mcpRequest, bool) {
	var request mcpRequest
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, mcpImageRequestLimit))
	if err != nil {
		writeMCPReply(r.Context(), w, http.StatusBadRequest, nil, nil, &mcpError{Code: -32700, Message: "请求超限或不完整"})
		return request, false
	}
	if !json.Valid(body) {
		writeMCPReply(r.Context(), w, http.StatusBadRequest, nil, nil, &mcpError{Code: -32700, Message: "JSON 格式无效"})
		return request, false
	}
	if json.Unmarshal(body, &request) != nil || request.Version != "2.0" || request.Method == "" {
		writeMCPReply(r.Context(), w, http.StatusBadRequest, nil, nil, &mcpError{Code: -32600, Message: "JSON-RPC 请求无效"})
		return request, false
	}
	if len(body) > 1<<20 {
		var call struct {
			Name string `json:"name"`
		}
		if request.Method != "tools/call" || json.Unmarshal(request.Params, &call) != nil ||
			(call.Name != "kb_upload_image" && (call.Name != "kb_update" || len(body) > mcpAvatarRequestLimit)) {
			writeMCPReply(r.Context(), w, http.StatusBadRequest, request.ID, nil, &mcpError{Code: -32700, Message: "请求超限或不完整"})
			return request, false
		}
	}
	if bytes.Equal(bytes.TrimSpace(request.Params), []byte("null")) {
		request.Params = nil
	}
	if len(request.Params) > 0 && !bytes.HasPrefix(bytes.TrimSpace(request.Params), []byte("{")) {
		writeMCPReply(r.Context(), w, http.StatusBadRequest, request.ID, nil, &mcpError{Code: -32602, Message: "参数必须为 JSON 对象"})
		return request, false
	}
	return request, true
}

func writeMCPReply(ctx context.Context, w http.ResponseWriter, status int, id json.RawMessage, result any, rpcErr *mcpError) {
	response := map[string]any{"jsonrpc": "2.0", "id": id}
	if rpcErr != nil {
		response["error"] = rpcErr
	} else {
		response["result"] = result
	}
	resource.JSON(ctx, w, status, response)
}

func writeMCPToolError(ctx context.Context, w http.ResponseWriter, id json.RawMessage, err error) {
	failure := resource.AsError(err)
	if failure.Status >= http.StatusInternalServerError {
		failure = &resource.Error{Status: http.StatusInternalServerError, Code: "mcp_internal_error", Message: "MCP 请求处理失败"}
	}
	code := failure.Code
	if code == "not_found" {
		code = "kb_not_found"
	}
	if failure.Status >= 500 {
		logging.Diagnostic(ctx, slog.Default(), slog.LevelError, "kb.mcp.tool.failed", err, slog.String("module", "kb"), slog.String("operation", "tools/call"))
	}
	payload := resource.Object{"code": code, "message": web.Message(ctx, code, failure.Message), "references": failure.References}
	data, _ := json.Marshal(payload)
	writeMCPReply(ctx, w, http.StatusOK, id, resource.Object{
		"content":           []any{resource.Object{"type": "text", "text": string(data)}},
		"structuredContent": payload,
		"isError":           true,
	}, nil)
}
