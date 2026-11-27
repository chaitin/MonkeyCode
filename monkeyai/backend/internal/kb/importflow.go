package kb

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

// These limits are shared by all knowledge-base services in this process.
// AnyDoc's own parser limit governs asynchronous work after create returns.
var anydocSubmissions = make(chan struct{}, 2)
var imageSubmissions = make(chan struct{}, 2)

func acquireImportSlot(ctx context.Context, slots chan struct{}) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case slots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-slots
			return nil, err
		}
		return func() { <-slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func multipartImportInput(formValue func(string) string) fileImportInput {
	in := fileImportInput{Title: formValue("title"), ModelID: formValue("model_id")}
	if parent := formValue("parent_id"); parent != "" {
		in.ParentID = &parent
	}
	return in
}

// startFileImport never returns source bytes. Its signed original reference also
// survives a downstream failure, so clients need not upload the same bytes again.
func (s *Service) startFileImport(ctx context.Context, c importContext, in fileImportInput) (resource.Object, error) {
	if err := s.importAccess(ctx, c); err != nil {
		return nil, err
	}
	if existing, err := s.mcpImportExisting(ctx, c); err != nil || existing != nil {
		return existing, err
	}
	// Once an attempt has started, its title, destination, model and callback
	// deadline stay stable across retries, including a lost create response.
	if c.Task == "" {
		c.ImportTitle = strings.TrimSpace(in.Title)
		if c.ImportTitle == "" {
			c.ImportTitle = c.Name
		}
		var err error
		c.TargetParent, err = normalizeParentID(in.ParentID)
		if err != nil {
			return nil, err
		}
		c.ModelID = strings.TrimSpace(in.ModelID)
		c.Task = c.DocumentID
		c.TaskExpires = min(c.Expires, time.Now().Add(30*time.Minute).Unix())
	}
	if imageFileType(c.Type) && strings.TrimSpace(in.ModelID) != "" {
		c.ModelID = strings.TrimSpace(in.ModelID)
	}
	if c.TargetParent != nil {
		parent, err := s.documentInKB(ctx, c.KB, *c.TargetParent)
		if err != nil {
			return nil, err
		}
		if parent.String("node_type") != "folder" {
			return nil, resource.Invalid("只能放到文件夹下")
		}
	}
	c.Purpose = "import"
	token, err := s.signImport(c)
	if err != nil {
		return nil, err
	}
	base := resource.Object{"import_context": token, "file_type": c.Type}
	fail := func(err error) (resource.Object, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		// Authorization failures must remain protocol errors, never retryable work.
		var business *resource.Error
		if errors.As(err, &business) && (business.Status == 401 || business.Status == 403 || business.Status == 404) {
			return nil, err
		}
		base["status"], base["error"] = "failed", "文件处理失败，请显式重试或重新导入"
		if errors.As(err, &business) {
			base["error"] = business.Message
			base["retryable"] = business.Code == "anydoc_unavailable" || business.Code == "anydoc_request_uncertain"
		}
		return base, nil
	}
	if imageFileType(c.Type) {
		saved, err := s.processImageImport(ctx, c, c.ModelID, true)
		if err != nil {
			return fail(err)
		}
		saved["import_context"] = token
		return saved, nil
	}
	if textFileType(c.Type) {
		storage, ok := s.storage.(ImportStorage)
		if !ok {
			return nil, resource.Invalid("文件对象存储未配置")
		}
		f, err := storage.Get(ctx, c.Key)
		if err != nil {
			return fail(err)
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, importContentLimit+4))
		if err != nil {
			return fail(err)
		}
		content, err := validateImportText(data)
		if err != nil {
			return fail(err)
		}
		saved, err := s.saveMCPImport(ctx, c, content, "")
		if err != nil {
			return fail(err)
		}
		saved["import_context"] = token
		return saved, nil
	}
	if c.TaskExpires <= time.Now().Unix() {
		base["status"], base["error"], base["restart_required"] = "failed", "转换凭证已过期，请重新导入", true
		return base, nil
	}
	attempt := c
	attempt.Expires = c.TaskExpires
	taskToken, err := s.submitFileConversion(ctx, attempt)
	if err != nil {
		return fail(err)
	}
	base["status"], base["task_context"], base["poll_after_seconds"] = "pending", taskToken, 3
	return base, nil
}

// finishFileImport runs only for an authenticated client request, never a worker.
func (s *Service) finishFileImport(ctx context.Context, c importContext) (resource.Object, error) {
	if c.Task == "" || c.Task != c.DocumentID || textFileType(c.Type) || imageFileType(c.Type) {
		return nil, resource.Invalid("转换上下文已失效，请重新导入")
	}
	if existing, err := s.mcpImportExisting(ctx, c); err != nil || existing != nil {
		return existing, err
	}
	raw, _, err := s.fileImportOperation(ctx, c, "query", fileImportInput{})
	if err != nil {
		return nil, err
	}
	result := raw.(resource.Object)
	if result.String("status") == "completed" && result.String("document_id") != "" {
		return result, nil
	}
	if result.String("status") != "completed" {
		result["poll_after_seconds"] = 3
		return result, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.saveMCPImport(ctx, c, result.String("content"), result.String("result_context"))
}

// imageUploadContext shares the import signature format and verification fields,
// but excludes document metadata from AnyDoc's size-limited uploader config.
type imageUploadContext struct {
	Purpose    string `json:"purpose"`
	ID         string `json:"import_id"`
	DocumentID string `json:"document_id"`
	Actor      string `json:"actor"`
	KB         string `json:"kb"`
	Admin      bool   `json:"admin"`
	Expires    int64  `json:"expires"`
}

// Callback and polling contexts share one fixed deadline and document task ID.
func (s *Service) submitFileConversion(ctx context.Context, c importContext) (string, error) {
	callback, err := url.Parse(s.anydoc.CallbackBaseURL)
	if err != nil || callback.Host == "" || (callback.Scheme != "http" && callback.Scheme != "https") {
		return "", resource.Invalid("anydoc 回调地址未配置")
	}
	upload := imageUploadContext{
		Purpose: "upload", ID: c.ID, DocumentID: c.DocumentID,
		Actor: c.Actor, KB: c.KB, Admin: c.Admin, Expires: c.Expires,
	}
	auth, err := s.signImport(upload)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(s.anydoc.CallbackBaseURL, "/") + "/internal/kb/imports/images/upload?token=" + url.QueryEscape(auth)
	if err := s.submitAnyDoc(ctx, c, resource.Object{"type": 1, "dir": c.ID, "http": resource.Object{"url": endpoint}}); err != nil {
		return "", err
	}
	c.Purpose = "task"
	return s.signImport(c)
}
