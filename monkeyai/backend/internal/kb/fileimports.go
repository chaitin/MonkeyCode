package kb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type fileImportInput struct {
	ImportContext string  `json:"import_context"`
	TaskContext   string  `json:"task_context"`
	Title         string  `json:"title"`
	ParentID      *string `json:"parent_id"`
	ModelID       string  `json:"model_id"`
}

func validateImportText(b []byte) (string, error) {
	b = bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})
	if len(b) > importContentLimit || !utf8.Valid(b) || bytes.ContainsRune(b, 0) || strings.TrimSpace(string(b)) == "" {
		return "", resource.Invalid("正文必须是非空 UTF-8 文本，且不超过 16 MiB")
	}
	return string(b), nil
}
func importType(name string, data []byte) (string, string, error) {
	t := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if t == "markdown" {
		t = "md"
	}
	if t == "htm" {
		t = "html"
	}
	if t == "jpeg" {
		t = "jpg"
	}
	if !knownFileType(t) {
		return "", "", resource.Invalid("不支持此文件格式（不支持 DOC、PPT）")
	}
	if imageFileType(t) {
		name, kind, err := readContentImage(data)
		if err != nil {
			return "", "", err
		}
		if filepath.Ext(name) != "."+t {
			return "", "", resource.Invalid("图片内容与文件后缀不匹配")
		}
		return t, kind, nil
	}
	m := map[string]string{"csv": "text/csv", "txt": "text/plain", "md": "text/markdown", "html": "text/html", "svg": "image/svg+xml", "pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "xls": "application/vnd.ms-excel"}[t]
	if textFileType(t) {
		_, e := validateImportText(data)
		return t, m, e
	}
	if (t == "pdf" && !bytes.HasPrefix(data, []byte("%PDF-"))) || (t == "xls" && !bytes.HasPrefix(data, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})) || ((t == "docx" || t == "xlsx" || t == "pptx") && !bytes.HasPrefix(data, []byte("PK\x03\x04"))) {
		return "", "", resource.Invalid("文件内容与格式不匹配")
	}
	return t, m, nil
}
func (s *Service) registerFileImports(r chi.Router, admin bool) {
	for _, op := range []string{"upload", "query", "result"} {
		r.Post("/kb/{id}/imports/"+op, func(w http.ResponseWriter, r *http.Request) { s.handleFileImport(w, r, admin, op) })
	}
	r.Get("/kb/{id}/imports/models", func(w http.ResponseWriter, r *http.Request) { s.serveImageModels(w, r, admin) })
	r.Get("/kb/{id}/documents/{documentId}/file/detail", func(w http.ResponseWriter, r *http.Request) { s.serveOriginal(w, r, admin) })
}
func (s *Service) importAccess(ctx context.Context, c importContext) error {
	tx, e := s.store.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	return s.importAccessTx(ctx, tx, c)
}
func (s *Service) importAccessTx(ctx context.Context, tx pgx.Tx, c importContext) error {
	active, e := sqlc.New(tx).KbImportActorActive(ctx, sqlc.KbImportActorActiveParams{Actor: c.Actor, Admin: c.Admin})
	if e != nil {
		return e
	}
	if !active {
		return resource.NotFound
	}
	book, e := resource.DecodeObject(sqlc.New(tx).LockKbResource(ctx, c.KB))
	if e != nil {
		return e
	}
	if c.Admin {
		if book.String("ownership_type") != "system" {
			return resource.NotFound
		}
	} else if e = requireContentWrite(ctx, tx, c.KB, c.Actor); e != nil {
		return e
	}
	return resource.RequireEditable(ctx, tx, "kb", c.KB)
}
func readImportMultipart(w http.ResponseWriter, r *http.Request) (string, []byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, importFileLimit+(64<<10))
	e := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if e != nil || r.MultipartForm == nil {
		return "", nil, resource.Invalid("请上传不超过 32 MiB 的文件")
	}
	files := r.MultipartForm.File["file"]
	if len(files) != 1 || len(r.MultipartForm.File) != 1 {
		return "", nil, resource.Invalid("请上传一个 file 文件")
	}
	f, e := files[0].Open()
	if e != nil {
		return "", nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, importFileLimit+1))
	if e != nil {
		return "", nil, e
	}
	if len(b) == 0 || len(b) > importFileLimit {
		return "", nil, resource.Invalid("文件大小无效")
	}
	return path.Base(strings.ReplaceAll(files[0].Filename, "\\", "/")), b, nil
}
func (s *Service) handleFileImport(w http.ResponseWriter, r *http.Request, admin bool, op string) {
	ctx := r.Context()
	actor, ok := identity.UserFromContext(ctx)
	if !ok {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	c := importContext{Actor: actor.ID, KB: chi.URLParam(r, "id"), Admin: admin}
	var out any
	var e error
	status := 200
	defer func() {
		if e != nil {
			resource.Fail(ctx, w, e)
		} else {
			resource.JSON(ctx, w, status, out)
		}
	}()
	if e = s.importAccess(ctx, c); e != nil {
		return
	}
	_, ok = s.storage.(ImportStorage)
	if !ok {
		e = &resource.Error{Status: 503, Code: "storage_unavailable", Message: "文件对象存储未配置"}
		return
	}
	if op == "upload" && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var name string
		var data []byte
		name, data, e = readImportMultipart(w, r)
		if e != nil {
			return
		}
		var uploaded resource.Object
		c.DocumentID, e = multipartDocumentID(c, r.PostFormValue("upload_key"), name, data)
		if e != nil {
			return
		}
		uploaded, e = s.uploadFileImport(ctx, c, name, data, false)
		if e != nil {
			return
		}
		c, e = s.verifyImport(uploaded.String("import_context"), "import")
		if e != nil {
			return
		}
		out, e = s.startFileImport(ctx, c, multipartImportInput(r.FormValue))
		return
	}

	var in fileImportInput
	r.Body = http.MaxBytesReader(w, r.Body, documentRequestLimit)
	if e = json.NewDecoder(r.Body).Decode(&in); e != nil {
		e = resource.Invalid("请求格式无效")
		return
	}
	token, purpose := in.ImportContext, "import"
	if op == "query" {
		token, purpose = in.TaskContext, "task"
	}
	c, e = s.verifyImport(token, purpose)
	if e != nil {
		return
	}
	if c.Actor != actor.ID || c.KB != chi.URLParam(r, "id") || c.Admin != admin {
		e = resource.NotFound
		return
	}
	switch op {
	case "upload":
		out, e = s.startFileImport(ctx, c, in)
	case "query":
		out, e = s.finishFileImport(ctx, c)
	default:
		out, status, e = s.fileImportOperation(ctx, c, op, in)
	}
}

// Bind browser retries to the same original without allowing callers to choose a document ID.
func multipartDocumentID(c importContext, key, name string, data []byte) (string, error) {
	if key == "" {
		return "", nil
	}
	nonce, err := hex.DecodeString(key)
	if err != nil || len(nonce) != 16 {
		return "", resource.Invalid("Invalid upload key")
	}
	scope, err := json.Marshal([]any{c.KB, c.Actor, c.Admin, nonce, name, sha256.Sum256(data)})
	if err != nil {
		return "", err
	}
	return uuid.NewHash(sha256.New(), uuid.NameSpaceOID, scope, 8).String(), nil
}

// uploadFileImport stores one original. MCP omits source content from the response.
func (s *Service) uploadFileImport(ctx context.Context, c importContext, name string, data []byte, includeContent bool) (resource.Object, error) {
	c.Purpose = "import"
	if c.DocumentID == "" {
		c.DocumentID = resource.ID()
	}
	c.ID = c.DocumentID
	c.Expires = time.Now().Add(24 * time.Hour).Unix()
	if _, err := s.signImport(c); err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > importFileLimit {
		return nil, resource.Invalid("文件大小无效")
	}
	c.Name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	if c.Name == "" || c.Name == "." {
		return nil, resource.Invalid("文件名不能为空")
	}
	var err error
	c.Type, c.MIME, err = importType(c.Name, data)
	if err != nil {
		return nil, err
	}

	c.Size = int64(len(data))
	c.Key = "knowledge/" + c.KB + "/imports/" + c.ID + "/original." + c.Type
	storage, ok := s.storage.(ImportStorage)
	if !ok {
		return nil, &resource.Error{Status: 503, Code: "storage_unavailable", Message: "文件对象存储未配置"}
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err = s.importAccessTx(ctx, tx, c); err != nil {
		return nil, err
	}
	if err = storage.PutOriginal(ctx, c.Key, data, c.MIME, c.Name); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	token, err := s.signImport(c)
	if err != nil {
		return nil, err
	}
	out := resource.Object{"import_context": token, "file_type": c.Type}
	if includeContent && textFileType(c.Type) {
		out["content"], err = validateImportText(data)
	}
	return out, err
}

// fileImportOperation shares conversion and commit semantics across HTTP and MCP.
// Callers verify the signed context's purpose and bind it to their authenticated actor.
func (s *Service) fileImportOperation(ctx context.Context, c importContext, op string, in fileImportInput) (out any, status int, e error) {
	status = http.StatusOK
	if e = s.importAccess(ctx, c); e != nil {
		return
	}
	_, ok := s.storage.(ImportStorage)
	if !ok {
		e = &resource.Error{Status: 503, Code: "storage_unavailable", Message: "文件对象存储未配置"}
		return
	}
	var token string
	if imageFileType(c.Type) && (op == "list" || op == "export" || op == "query") {
		return nil, 0, resource.Invalid("图片仅通过 LLM 解析，不支持 anydoc 转换")
	}
	switch op {
	case "query":
		var task anydocTask
		e = s.anydocRequest(ctx, http.MethodGet, "/api/slim/task/result?task_id="+url.QueryEscape(c.Task), "", nil, &task)
		if errors.Is(e, errAnyDocTaskMissing) {
			// Another query may have committed and deleted the upstream task
			// after our initial existence check. Reconcile before failing.
			var existing resource.Object
			existing, e = s.mcpImportExisting(ctx, c)
			if e != nil {
				return
			}
			if existing != nil {
				out = existing
				return
			}
			e = nil
			out = resource.Object{"status": "failed", "restart_required": true, "error": "转换任务已失效，请重新开始导入"}
			return
		}
		if e != nil {
			return
		}
		if e = validateAnyDocTask(task, c.Task); e != nil {
			return
		}
		switch task.Status {
		case "in_process":
			out = resource.Object{"status": "pending"}
		case "failed":
			out = resource.Object{"status": "failed", "restart_required": true, "error": "文件转换失败，请检查文件后重新导入"}
		case "completed":
			if task.Markdown == nil {
				return nil, 0, errors.New("anydoc 未返回 Markdown 正文")
			}
			var content string
			content, e = validateImportText([]byte(*task.Markdown))
			if e != nil {
				return
			}
			if e = s.validateConvertedAssets(ctx, c.KB, content); e != nil {
				return
			}
			if e = s.importAccess(ctx, c); e != nil {
				return
			}
			c.Purpose = "result"
			c.Hash = convertedHash(content)
			token, e = s.signImport(c)
			out = resource.Object{"status": "completed", "content": content, "result_context": token}
		}
	case "result":
		var doc resource.Object
		doc, e = s.GetDocument(ctx, c.DocumentID)
		if errors.Is(e, pgx.ErrNoRows) {
			e = nil
			out = resource.Object{"exists": false}
			return
		}
		if e != nil {
			return
		}
		if doc.String("kb_id") != c.KB || doc.String("created_by_user_id") != c.Actor || doc.String("storage_key") != c.Key {
			e = resource.NotFound
			return
		}
		out = resource.Object{"exists": true, "document_id": c.DocumentID}
	default:
		e = resource.Invalid("不支持的文件导入操作")
	}
	return
}

func (s *Service) commitFileImport(ctx context.Context, c importContext, result, title string, parent *string, content string) (resource.Object, bool, error) {
	input := DocumentInput{KbID: c.KB, Title: title, ParentID: parent, Content: content, SourceType: "file", FileName: c.Name, MimeType: c.MIME, SizeBytes: int64(len(content)), imported: &c, resultContext: result}
	if !textFileType(c.Type) {
		input.FileName = strings.TrimSuffix(c.Name, filepath.Ext(c.Name)) + ".md"
		input.MimeType = "text/markdown"
	}
	doc, e := s.createDocument(ctx, c.Actor, input, !c.Admin)
	created := doc.Bool("import_created")
	delete(doc, "import_created")
	if e == nil && !textFileType(c.Type) && !imageFileType(c.Type) {
		// The authenticated result proof carries the exact attempt that supplied this body.
		if proof, err := s.verifyImport(result, "result"); err == nil && proof.ID == c.ID && proof.KB == c.KB && proof.Actor == c.Actor && proof.DocumentID == c.DocumentID {
			s.cleanupAnyDoc(ctx, proof.Task)
		}
	}

	return doc, created, e
}
func (s *Service) RegisterImportCallbacks(r chi.Router) {
	r.Post("/internal/kb/imports/images/upload", s.uploadImportImage)
}
func (s *Service) uploadImportImage(w http.ResponseWriter, r *http.Request) {
	c, e := s.verifyImport(r.URL.Query().Get("token"), "upload")
	if e != nil {
		resource.Fail(r.Context(), w, e)
		return
	}
	if e = s.importAccess(r.Context(), c); e != nil {
		resource.Fail(r.Context(), w, e)
		return
	}
	result, e := s.storeContentImage(r.Context(), c.Actor, c.KB, c.Admin, func() ([]byte, error) {
		_, b, e := readImportMultipart(w, r)
		if e != nil {
			return nil, e
		}
		p := r.FormValue("path")
		if !strings.HasPrefix(p, c.ID+"/") || strings.Count(p, "/") != 1 || path.Clean(p) != p || strings.Contains(p, "\\") {
			return nil, resource.Invalid("图片路径无效")
		}
		return b, nil
	})
	if e != nil {
		resource.Fail(r.Context(), w, e)
		return
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"code": 0, "err": "", "data": result.String("url")})
}
func (s *Service) serveOriginal(w http.ResponseWriter, r *http.Request, admin bool) {
	ctx := r.Context()
	actor, ok := identity.UserFromContext(ctx)
	if !ok {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	var doc resource.Object
	var e error
	if admin {
		doc, e = s.documentInKB(ctx, chi.URLParam(r, "id"), chi.URLParam(r, "documentId"))
	} else {
		doc, e = s.GetAccessibleDocumentInKB(ctx, actor.ID, chi.URLParam(r, "id"), chi.URLParam(r, "documentId"))
	}
	if e != nil {
		resource.Fail(ctx, w, e)
		return
	}
	storage, ok := s.storage.(ImportStorage)
	if !ok || doc.String("storage_key") == "" {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	name, kind, _, e := storage.OriginalInfo(ctx, doc.String("storage_key"))
	if e != nil {
		resource.Fail(ctx, w, e)
		return
	}
	if name == "" {
		name = "original"
	}
	if kind == "" {
		kind = "application/octet-stream"
	}
	disposition := "attachment"
	if r.URL.Query().Get("preview") == "true" && (doc.String("file_type") == "pdf" || imageFileType(doc.String("file_type"))) {
		disposition = "inline"
		kind = map[string]string{"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}[doc.String("file_type")]
	}
	f, e := storage.Get(ctx, doc.String("storage_key"))
	if e != nil {
		resource.Fail(ctx, w, e)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = io.Copy(w, io.LimitReader(f, importFileLimit))
}
