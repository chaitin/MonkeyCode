package imageproxy

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

const imageProtocol = "image_generation"

type Reference struct {
	FileID string `json:"file_id"`
}

type GenerateRequest struct {
	Model           string      `json:"model"`
	Prompt          string      `json:"prompt"`
	ReferenceImages []Reference `json:"reference_images,omitempty"`
	Quality         string      `json:"quality,omitempty"`
	AspectRatio     string      `json:"aspect_ratio,omitempty"`
	Count           *uint32     `json:"count,omitempty"`
	IdempotencyKey  string      `json:"-"`
}

type EditRequest struct {
	Model          string      `json:"model"`
	Prompt         string      `json:"prompt"`
	Images         []Reference `json:"images"`
	Mask           *Reference  `json:"mask,omitempty"`
	Quality        string      `json:"quality,omitempty"`
	AspectRatio    string      `json:"aspect_ratio,omitempty"`
	Count          *uint32     `json:"count,omitempty"`
	IdempotencyKey string      `json:"-"`
}

type Output struct {
	URL      string `json:"url"`
	MIMEType string `json:"mime_type"`
	Width    uint32 `json:"width"`
	Height   uint32 `json:"height"`
}

type Usage struct {
	RequestedImages uint32 `json:"requested_images"`
	GeneratedImages uint32 `json:"generated_images"`
	Credits         string `json:"credits,omitempty"`
}

type Task struct {
	UserID    string   `json:"-"`
	ID        string   `json:"id"`
	Operation string   `json:"operation"`
	Status    string   `json:"status"`
	Outputs   []Output `json:"outputs,omitempty"`
	Usage     *Usage   `json:"usage,omitempty"`
}

type KeyAuthenticator interface {
	Authenticate(context.Context, string, string) (string, error)
}

type Generator interface {
	Generate(context.Context, proxy.Target, GenerateRequest) (Task, error)
}

type Editor interface {
	Edit(context.Context, proxy.Target, EditRequest) (Task, error)
}

type TaskQuerier interface {
	Get(context.Context, string, string) (Task, error)
}

type InputFile struct {
	FileID    string    `json:"file_id"`
	MIMEType  string    `json:"mime_type"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	ExpiresAt time.Time `json:"expires_at"`
}

type InputUploader interface {
	Upload(context.Context, string, []byte) (InputFile, error)
}

type OutputReader interface {
	Open(context.Context, string, string) ([]byte, string, error)
}

type Proxy struct {
	resolver  proxy.Resolver
	keys      KeyAuthenticator
	generator Generator
	editor    Editor
	tasks     TaskQuerier
	inputs    InputUploader
	outputs   OutputReader
}

func NewProxy(resolver proxy.Resolver, keys KeyAuthenticator, generator Generator, editor Editor, tasks TaskQuerier) *Proxy {
	return &Proxy{resolver: resolver, keys: keys, generator: generator, editor: editor, tasks: tasks}
}

func (p *Proxy) WithInputs(inputs InputUploader) *Proxy {
	p.inputs = inputs
	return p
}

func (p *Proxy) WithOutputs(outputs OutputReader) *Proxy {
	p.outputs = outputs
	return p
}

func (p *Proxy) Register(router chi.Router) {
	router.Post("/v1/images/inputs", p.upload)
	router.Get("/v1/images/outputs/{id}", p.output)
	router.Post("/v1/images/generations", p.generate)
	router.Post("/v1/images/edits", p.edit)
	router.Get("/v1/images/tasks/{id}", p.task)
}

func (p *Proxy) upload(w http.ResponseWriter, r *http.Request) {
	credential, ok := proxy.Credential(r)
	if !ok {
		unauthorized(w)
		return
	}
	if p.keys == nil || p.inputs == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	userID, err := p.keys.Authenticate(r.Context(), credential, "model:invoke")
	if err != nil || userID == "" {
		if err != nil && r.Context().Err() == nil {
			slog.Warn("生图鉴权失败", "operation", "authenticate_upload", "error", credentialError(err, credential))
		}
		unauthorized(w)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 17<<20)
	parts, err := r.MultipartReader()
	if err != nil {
		resource.Fail(w, resource.Invalid("参考图上传格式无效"))
		return
	}
	part, err := parts.NextPart()
	if err != nil || part.FormName() != "file" {
		resource.Fail(w, resource.Invalid("缺少参考图 file 字段"))
		return
	}
	data, err := io.ReadAll(io.LimitReader(part, (16<<20)+1))
	if err != nil || len(data) == 0 || len(data) > 16<<20 {
		resource.Fail(w, resource.Invalid("参考图超过大小限制"))
		return
	}
	if _, err := parts.NextPart(); !errors.Is(err, io.EOF) {
		resource.Fail(w, resource.Invalid("每次只能上传一张参考图"))
		return
	}
	result, err := p.inputs.Upload(r.Context(), userID, data)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusCreated, result)
}

func (p *Proxy) output(w http.ResponseWriter, r *http.Request) {
	credential, ok := proxy.Credential(r)
	if !ok {
		unauthorized(w)
		return
	}
	if p.keys == nil || p.outputs == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	userID, err := p.keys.Authenticate(r.Context(), credential, "model:invoke")
	if err != nil || userID == "" {
		if err != nil && r.Context().Err() == nil {
			slog.Warn("生图鉴权失败", "operation", "authenticate_output", "error", credentialError(err, credential))
		}
		unauthorized(w)
		return
	}
	data, mime, err := p.outputs.Open(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if (mime != "image/png" && mime != "image/jpeg" && mime != "image/webp") || http.DetectContentType(data) != mime {
		resource.Fail(w, errors.New("图片内容校验失败"))
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := w.Write(data); err != nil && r.Context().Err() == nil {
		slog.Warn("生图结果响应写入失败", "operation", "write_output", "user_id", userID, "error", err)
	}
}

func (p *Proxy) generate(w http.ResponseWriter, r *http.Request) {
	credential, ok := proxy.Credential(r)
	if !ok {
		unauthorized(w)
		return
	}
	var input GenerateRequest
	if err := decode(w, r, &input); err != nil {
		resource.Fail(w, err)
		return
	}
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	if err := valid(input.Model, input.Prompt, input.Count); err != nil {
		resource.Fail(w, err)
		return
	}
	for _, image := range input.ReferenceImages {
		if strings.TrimSpace(image.FileID) == "" {
			resource.Fail(w, resource.Invalid("参考图 file_id 不能为空"))
			return
		}
	}
	target, ok := p.resolve(w, r, credential, input.Model)
	if !ok {
		return
	}
	if p.generator == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	task, err := p.generator.Generate(r.Context(), target, input)
	respond(w, task, err)
}

func (p *Proxy) edit(w http.ResponseWriter, r *http.Request) {
	credential, ok := proxy.Credential(r)
	if !ok {
		unauthorized(w)
		return
	}
	var input EditRequest
	if err := decode(w, r, &input); err != nil {
		resource.Fail(w, err)
		return
	}
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	if err := valid(input.Model, input.Prompt, input.Count); err != nil {
		resource.Fail(w, err)
		return
	}
	if len(input.Images) == 0 {
		resource.Fail(w, resource.Invalid("编辑至少需要一张原图"))
		return
	}
	for _, image := range input.Images {
		if strings.TrimSpace(image.FileID) == "" {
			resource.Fail(w, resource.Invalid("原图 file_id 不能为空"))
			return
		}
	}
	if input.Mask != nil && strings.TrimSpace(input.Mask.FileID) == "" {
		resource.Fail(w, resource.Invalid("蒙版 file_id 不能为空"))
		return
	}
	target, ok := p.resolve(w, r, credential, input.Model)
	if !ok {
		return
	}
	if p.editor == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	task, err := p.editor.Edit(r.Context(), target, input)
	respond(w, task, err)
}

func (p *Proxy) task(w http.ResponseWriter, r *http.Request) {
	credential, ok := proxy.Credential(r)
	if !ok {
		unauthorized(w)
		return
	}
	if p.keys == nil || p.tasks == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	userID, err := p.keys.Authenticate(r.Context(), credential, "model:invoke")
	if err != nil || userID == "" {
		if err != nil && r.Context().Err() == nil {
			slog.Warn("生图鉴权失败", "operation", "authenticate_task", "error", credentialError(err, credential))
		}
		unauthorized(w)
		return
	}
	taskID := chi.URLParam(r, "id")
	result, err := p.tasks.Get(r.Context(), userID, taskID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if result.UserID != userID || result.ID != taskID {
		resource.Fail(w, resource.NotFound)
		return
	}
	resource.JSON(w, http.StatusOK, result)
}

func (p *Proxy) resolve(w http.ResponseWriter, r *http.Request, credential, model string) (proxy.Target, bool) {
	if p.resolver == nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return proxy.Target{}, false
	}
	target, err := p.resolver.Resolve(r.Context(), credential, model)
	if err != nil || target.UserID == "" {
		if err != nil && r.Context().Err() == nil {
			slog.Warn("生图模型解析失败", "operation", "resolve", "error", credentialError(err, credential))
		}
		unauthorized(w)
		return proxy.Target{}, false
	}
	if target.Protocol != imageProtocol {
		resource.Fail(w, resource.Invalid("模型不支持生图"))
		return proxy.Target{}, false
	}
	return target, true
}

func valid(model, prompt string, count *uint32) error {
	if strings.TrimSpace(model) == "" || strings.TrimSpace(prompt) == "" {
		return resource.Invalid("model 和 prompt 不能为空")
	}
	if count != nil && *count == 0 {
		return resource.Invalid("count 必须大于 0")
	}
	return nil
}

func decode(w http.ResponseWriter, r *http.Request, value any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return resource.Invalid("生图请求格式无效")
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return resource.Invalid("生图请求只能包含一个 JSON 对象")
	}
	return nil
}

func respond(w http.ResponseWriter, task Task, err error) {
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if task.ID == "" {
		resource.Fail(w, errors.New("生图任务缺少 ID"))
		return
	}
	resource.JSON(w, http.StatusAccepted, task)
}

func credentialError(err error, credential string) string {
	if credential == "" {
		return err.Error()
	}
	return strings.ReplaceAll(err.Error(), credential, "[redacted]")
}

func unauthorized(w http.ResponseWriter) {
	http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
}
