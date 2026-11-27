package kb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) registerMCPFileUpload(router chi.Router, keys MCPKeyAuthenticator) {
	router.Post("/mcp/kb/{id}/files/upload", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp"`)
			resource.Fail(r.Context(), w, &resource.Error{Status: 401, Code: "invalid_key", Message: "缺少 MCP 调用密钥"})
			return
		}
		actor, err := keys.Authenticate(r.Context(), strings.TrimSpace(token), "mcp:invoke")
		if err != nil {
			w.Header().Set("WWW-Authenticate", `Bearer realm="mcp", error="invalid_token"`)
			resource.Fail(r.Context(), w, &resource.Error{Status: 401, Code: "invalid_key", Message: "MCP 调用密钥无效或权限不足"})
			return
		}
		c := importContext{Actor: actor, KB: chi.URLParam(r, "id")}
		// Reject unauthorized uploads before reading file bytes.
		if err = s.importAccess(r.Context(), c); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		name, data, err := readImportMultipart(w, r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		c.DocumentID, err = multipartDocumentID(c, r.PostFormValue("upload_key"), name, data)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out, err := s.uploadFileImport(r.Context(), c, name, data, false)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		c, err = s.verifyImport(out.String("import_context"), "import")
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out, err = s.startFileImport(r.Context(), c, multipartImportInput(r.FormValue))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusCreated, out)
	})
}

type mcpFileInput struct {
	UploadKey string  `json:"upload_key"`
	KB        string  `json:"kb_id"`
	Name      string  `json:"file_name"`
	Data      string  `json:"data_base64"`
	Import    string  `json:"import_context"`
	Task      string  `json:"task_context"`
	Title     string  `json:"title"`
	Parent    *string `json:"parent_id"`
	ModelID   string  `json:"model_id"`
}

func (s *Service) callMCPFileImport(ctx context.Context, actor, tool string, args map[string]any) (resource.Object, error) {
	allowed := map[string]bool{"upload_key": true, "kb_id": true, "file_name": true, "data_base64": true, "import_context": true, "title": true, "parent_id": true, "model_id": true}
	if tool == "kb_get_file_import_status" {
		allowed = map[string]bool{"kb_id": true, "task_context": true}
	}
	for key := range args {
		if !allowed[key] {
			return nil, resource.Invalid("不支持的文件导入参数: " + key)
		}
	}
	data, err := json.Marshal(args)
	if err != nil {
		return nil, resource.Invalid("文件导入参数无效")
	}
	var in mcpFileInput
	if json.Unmarshal(data, &in) != nil || strings.TrimSpace(in.KB) == "" {
		return nil, resource.Invalid("文件导入参数无效，kb_id 必填")
	}
	in.KB = strings.TrimSpace(in.KB)
	if tool == "kb_get_file_import_status" {
		c, err := s.verifyImport(in.Task, "task")
		if err != nil {
			return nil, err
		}
		if c.Actor != actor || c.KB != in.KB || c.Admin {
			return nil, resource.NotFound
		}
		return s.finishFileImport(ctx, c)
	}
	if err = s.importAccess(ctx, importContext{Actor: actor, KB: in.KB}); err != nil {
		return nil, err
	}
	if in.Import == "" && in.Data == "" && in.Name == "" {
		return resource.Object{"status": "upload_required", "upload_path": "/mcp/kb/" + in.KB + "/files/upload", "method": "POST", "encoding": "multipart/form-data", "file_field": "file", "idempotency_field": "upload_key", "idempotency_format": "32 hexadecimal characters; reuse for retries of the same upload", "authentication": "Authorization: Bearer <same MCP Key>", "max_file_bytes": importFileLimit, "supported_formats": []string{"txt", "md", "markdown", "html", "htm", "svg", "csv", "docx", "xls", "xlsx", "pptx", "pdf", "jpg", "jpeg", "png"}, "next": "客户端在模型上下文之外上传文件及 title/parent_id，图片另传 model_id；上传即开始处理，pending 时用 task_context 查询；不要让模型生成或搬运文件 Base64"}, nil
	}
	if in.Import != "" && (in.Data != "" || in.Name != "") {
		return nil, resource.Invalid("import_context 与文件字节不能同时提供")
	}
	token := in.Import
	if token == "" {
		if in.Name == "" || len(in.Data) == 0 || len(in.Data) > mcpImageBase64Limit {
			return nil, resource.Invalid("需要 file_name 和不超过 32 MiB 的文件 Base64")
		}
		original, err := base64.StdEncoding.Strict().DecodeString(in.Data)
		if err != nil {
			return nil, resource.Invalid("文件必须使用标准 Base64，不包含 data URL 前缀")
		}
		uploadContext := importContext{Actor: actor, KB: in.KB}
		uploadContext.DocumentID, err = multipartDocumentID(uploadContext, in.UploadKey, in.Name, original)
		if err != nil {
			return nil, err
		}
		uploaded, err := s.uploadFileImport(ctx, uploadContext, in.Name, original, false)
		if err != nil {
			return nil, err
		}
		token = uploaded.String("import_context")
	}
	c, err := s.verifyImport(token, "import")
	if err != nil {
		return nil, err
	}
	if c.Actor != actor || c.KB != in.KB || c.Admin {
		return nil, resource.NotFound
	}
	return s.startFileImport(ctx, c, fileImportInput{Title: in.Title, ParentID: in.Parent, ModelID: in.ModelID})
}

// Query before conversion or saving so a lost reply never duplicates a document.
func (s *Service) mcpImportExisting(ctx context.Context, c importContext) (resource.Object, error) {
	raw, _, err := s.fileImportOperation(ctx, c, "result", fileImportInput{})
	if err != nil {
		return nil, err
	}
	existing := raw.(resource.Object)
	if !existing.Bool("exists") {
		return nil, nil
	}
	return resource.Object{"status": "completed", "document_id": existing.String("document_id"), "file_type": c.Type}, nil
}
func (s *Service) saveMCPImport(ctx context.Context, c importContext, content, proof string) (resource.Object, error) {
	doc, _, err := s.commitFileImport(ctx, c, proof, c.ImportTitle, c.TargetParent, content)
	if err != nil {
		return nil, err
	}
	return resource.Object{"status": "completed", "document_id": doc.String("id"), "title": doc.String("title"), "file_type": doc.String("file_type"), "learning_status": doc.String("status")}, nil
}

func mcpFileTools() []resource.Object {
	return []resource.Object{
		{"name": "kb_upload_file", "description": "导入 TXT/Markdown/HTML/SVG/CSV/DOCX/XLS/XLSX/PPTX/PDF/JPEG/JPG/PNG，不支持 DOC/PPT。只传 kb_id 获取 multipart 上传地址；客户端使用同一 mcp:invoke Key 在模型上下文之外上传文件及 title/parent_id，图片必须提供 model_id。上传即开始处理，文本及图片成功返回 completed/document_id，Office/PDF 返回 pending/task_context，按 poll_after_seconds 调 kb_get_file_import_status。也可由客户端程序化提供 file_name/data_base64，最多32 MiB；禁止模型生成、复制或搬运 Base64。不接受本地路径或任意URL。import_context 可复用原件继续提交，与文件字节互斥。图片同步付费解析，失败不静默自动重试。页面或客户端退出后不后台查询或入库；同一 document_id 直接作为 anydoc task_id 并去重保存。", "inputSchema": mcpObjectSchema(resource.Object{
			"upload_key":     resource.Object{"type": "string", "pattern": "^[0-9a-fA-F]{32}$", "description": "客户端生成的上传幂等键，同一次上传重试必须复用；与 file_name/data_base64 一起提供"},
			"kb_id":          mcpIDSchema(),
			"model_id":       mcpIDSchema(),
			"file_name":      resource.Object{"type": "string", "minLength": 1, "maxLength": 1024},
			"data_base64":    resource.Object{"type": "string", "minLength": 1, "maxLength": mcpImageBase64Limit, "description": "仅由客户端在模型上下文之外程序化读取、编码、注入。优先使用 multipart 上传后传 import_context；禁止模型复制或生成 Base64"},
			"import_context": resource.Object{"type": "string", "maxLength": 32768, "description": "二进制上传返回的签名上下文，与 file_name/data_base64 互斥；同一上下文重试不重复保存文档"},
			"title":          resource.Object{"type": "string", "description": "省略时使用原文件名"},
			"parent_id":      mcpCreateParentSchema(),
		}, "kb_id")},
		{"name": "kb_get_file_import_status", "description": "查询 kb_upload_file 返回的转换任务。pending 时按 poll_after_seconds 等待后再查；completed 表示文档和学习任务已保存（学习仍异步）。服务端直接读取并保存 anydoc slim 返回的 Markdown 正文，只返回状态与 document_id，不回传文件或正文。网络异常时可重查；任务失效、失败或超过30分钟时重新上传，分配新文档 ID；上游暂时不可用或提交结果不确定且 retryable=true 时，按原 import_context 延迟重试。已保存时重查返回同一文档，不覆盖正文、不重复学习。", "inputSchema": mcpObjectSchema(resource.Object{
			"kb_id": mcpIDSchema(), "task_context": resource.Object{"type": "string", "minLength": 1, "maxLength": 32768},
		}, "kb_id", "task_context")},
	}
}
