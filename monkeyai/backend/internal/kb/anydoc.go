package kb

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const importFileLimit = 32 << 20
const importContentLimit = 16 << 20

type ImportStorage interface {
	resource.Storage
	PutOriginal(context.Context, string, []byte, string, string) error
	OriginalInfo(context.Context, string) (string, string, int64, error)
}
type AnyDocConfig struct{ URL, CallbackBaseURL, SigningKey string }
type importContext struct {
	Purpose      string  `json:"purpose"`
	ID           string  `json:"import_id"`
	DocumentID   string  `json:"document_id"`
	Actor        string  `json:"actor"`
	KB           string  `json:"kb"`
	Admin        bool    `json:"admin"`
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	MIME         string  `json:"mime"`
	Size         int64   `json:"size"`
	Expires      int64   `json:"expires"`
	Task         string  `json:"task,omitempty"`
	TaskExpires  int64   `json:"task_expires,omitempty"`
	Hash         string  `json:"hash,omitempty"`
	ImportTitle  string  `json:"import_title,omitempty"`
	TargetParent *string `json:"target_parent,omitempty"`
	ModelID      string  `json:"model_id,omitempty"`
}

func (s *Service) WithAnyDoc(c AnyDocConfig) *Service { s.anydoc = c; return s }
func (s *Service) signImport(c any) (string, error) {
	if len(s.anydoc.SigningKey) < 32 {
		return "", &resource.Error{Status: 503, Code: "import_unavailable", Message: "文件导入签名密钥未配置"}
	}
	b, e := json.Marshal(c)
	if e != nil {
		return "", e
	}
	p := base64.RawURLEncoding.EncodeToString(b)
	h := hmac.New(sha256.New, []byte(s.anydoc.SigningKey))
	h.Write([]byte(p))
	return p + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil)), nil
}
func (s *Service) verifyImport(token, purpose string) (importContext, error) {
	var c importContext
	bad := resource.Invalid("导入凭证无效或已过期")
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 32768 || len(s.anydoc.SigningKey) < 32 {
		return c, bad
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return c, bad
	}
	h := hmac.New(sha256.New, []byte(s.anydoc.SigningKey))
	h.Write([]byte(parts[0]))
	if !hmac.Equal(sig, h.Sum(nil)) {
		return c, bad
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return c, bad
	}
	if json.Unmarshal(b, &c) != nil || c.Purpose != purpose || c.Expires <= time.Now().Unix() || c.Actor == "" || c.KB == "" || c.ID == "" || c.DocumentID == "" {
		return c, bad
	}
	return c, nil
}
func convertedHash(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}
func textFileType(t string) bool {
	return t == "txt" || t == "md" || t == "html" || t == "svg" || t == "csv"
}

func knownFileType(t string) bool {
	return textFileType(t) || imageFileType(t) || t == "docx" || t == "xls" || t == "xlsx" || t == "pptx" || t == "pdf"
}

// anydocTask contains the slim result, whose markdown is content, never a path.
type anydocTask struct {
	TaskID   string  `json:"task_id"`
	Status   string  `json:"status"`
	Err      string  `json:"err"`
	Markdown *string `json:"markdown"`
}

func (s *Service) anydocRequest(ctx context.Context, method, endpoint, contentType string, body io.Reader, output any) error {
	u, e := url.Parse(s.anydoc.URL)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return &resource.Error{Status: 503, Code: "anydoc_unavailable", Message: "anydoc 未配置"}
	}
	req, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.anydoc.URL, "/")+endpoint, body)
	if e != nil {
		return e
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return &resource.Error{Status: 503, Code: "anydoc_request_uncertain", Message: "anydoc 请求结果不确定，请使用相同上下文重试"}
	}
	defer resp.Body.Close()
	// JSON escapes can expand every source byte to six bytes; validate decoded text separately.
	const responseLimit = 6*importContentLimit + (64 << 10)
	data, e := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if e != nil {
		return &resource.Error{Status: 503, Code: "anydoc_request_uncertain", Message: "anydoc 响应读取失败，请使用相同上下文重试"}
	}
	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		return &resource.Error{Status: 503, Code: "anydoc_unavailable", Message: "anydoc 繁忙，请稍后使用相同上下文重试"}
	}
	if len(data) > responseLimit {
		return errors.New("anydoc 响应超限")
	}
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Err     string          `json:"err"`
	}
	if json.Unmarshal(data, &envelope) != nil {
		return &resource.Error{Status: 503, Code: "anydoc_request_uncertain", Message: "anydoc 响应格式无效，请使用相同上下文重试"}
	}
	if resp.StatusCode == 404 && envelope.Err == "task_not_found" {
		return errAnyDocTaskMissing
	}
	if (resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted) || !envelope.Success {
		return errors.New("anydoc 转换请求失败")
	}
	if output == nil {
		return nil
	}
	return json.Unmarshal(envelope.Data, output)
}

var errAnyDocTaskMissing = errors.New("anydoc 任务已失效，请重新开始转换")

func (s *Service) submitAnyDoc(ctx context.Context, c importContext, uploader any) error {
	release, err := acquireImportSlot(ctx, anydocSubmissions)
	if err != nil {
		return err
	}
	defer release()
	var task anydocTask
	// Reconcile a lost create response before uploading the same bytes again.
	err = s.anydocRequest(ctx, http.MethodGet, "/api/slim/task/result?task_id="+url.QueryEscape(c.Task), "", nil, &task)
	if err == nil {
		return validateAnyDocTask(task, c.Task)
	}
	if !errors.Is(err, errAnyDocTaskMissing) {
		return err
	}
	storage, ok := s.storage.(ImportStorage)
	if !ok {
		return errors.New("文件对象存储未配置")
	}
	original, err := storage.Get(ctx, c.Key)
	if err != nil {
		return err
	}
	defer original.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err = writer.WriteField("task_id", c.Task); err != nil {
		return err
	}
	config, err := json.Marshal(uploader)
	if err != nil {
		return err
	}
	if err = writer.WriteField("uploader", string(config)); err != nil {
		return err
	}
	file, err := writer.CreateFormFile("file", c.Name)
	if err != nil {
		return err
	}
	n, err := io.Copy(file, io.LimitReader(original, importFileLimit+1))
	if err != nil {
		return err
	}
	if n == 0 || n > importFileLimit || n != c.Size {
		return errors.New("导入原件大小不匹配或超限")
	}
	if err = writer.Close(); err != nil {
		return err
	}

	err = s.anydocRequest(ctx, http.MethodPost, "/api/slim/task/create", writer.FormDataContentType(), &body, &task)
	if err != nil {
		return err
	}
	return validateAnyDocTask(task, "") // create deliberately omits task_id.
}

func validateAnyDocTask(task anydocTask, id string) error {
	if id != "" && task.TaskID != id {
		return errors.New("anydoc 任务标识不匹配")
	}
	switch task.Status {
	case "in_process", "completed", "failed":
		return nil
	default:
		return errors.New("anydoc 任务状态无效")
	}
}

// Cleanup is best effort and only follows a durable document commit.
func (s *Service) cleanupAnyDoc(ctx context.Context, task string) {
	if task == "" {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = s.anydocRequest(cleanupCtx, http.MethodDelete, "/api/slim/task/delete?task_id="+url.QueryEscape(task), "", nil, nil)
}
