package proxy

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/rokku-c/go-openai"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/diff"
)

type Recorder struct {
	cfg     *config.Config
	usecase domain.ProxyUsecase
	shadown chan []byte
	src     io.ReadCloser
	ctx     *ProxyCtx
	logger  *slog.Logger
	logFile *os.File
}

var _ io.ReadCloser = &Recorder{}

func NewRecorder(
	cfg *config.Config,
	ctx *ProxyCtx,
	src io.ReadCloser,
	logger *slog.Logger,
	usecase domain.ProxyUsecase,
) *Recorder {
	r := &Recorder{
		cfg:     cfg,
		usecase: usecase,
		shadown: make(chan []byte, 128*1024),
		src:     src,
		ctx:     ctx,
		logger:  logger,
	}
	go r.handleShadow()
	return r
}

func formatHeader(header http.Header) map[string]string {
	headerMap := make(map[string]string)
	for key, values := range header {
		headerMap[key] = strings.Join(values, ",")
	}
	return headerMap
}

func (r *Recorder) handleShadow() {
	body, err := r.ctx.ReqTee.GetBody()
	if err != nil {
		r.logger.WarnContext(r.ctx.ctx, "get req tee body failed", "error", err)
		return
	}

	var (
		taskID, mode, prompt, language, tool, code, sourceCode, userInput string
		cursorPosition                                                    map[string]any
	)

	switch r.ctx.Model.ModelType {
	case consts.ModelTypeLLM:
		var req openai.ChatCompletionRequest
		if err := json.Unmarshal(body, &req); err != nil {
			r.logger.WarnContext(r.ctx.ctx, "unmarshal chat completion request failed", "error", err)
			return
		}
		prompt = req.Metadata["prompt"]
		taskID = req.Metadata["task_id"]
		mode = req.Metadata["mode"]
		tool = req.Metadata["tool"]
		code = req.Metadata["code"]
		if md := r.ctx.Metadata; len(md) > 0 {
			prompt = md["prompt"]
			taskID = md["task_id"]
			mode = md["mode"]
			tool = md["tool"]
			code = md["code"]
		}

	case consts.ModelTypeCoder:
		var req domain.CompletionRequest
		if err := json.Unmarshal(body, &req); err != nil {
			r.logger.WarnContext(r.ctx.ctx, "unmarshal completion request failed", "error", err)
			return
		}
		prompt = req.Prompt.(string)
		taskID = req.Metadata["task_id"]
		mode = req.Metadata["mode"]
		language = req.Metadata["program_language"]
		sourceCode = req.Metadata["source_code"]
		// 解析cursor_position为JSON格式
		if posStr := req.Metadata["cursor_position"]; posStr != "" {
			if pos, err := strconv.ParseInt(posStr, 10, 64); err == nil {
				cursorPosition = map[string]any{
					"position": pos,
					"line":     1, // 默认值
					"column":   pos,
				}
			}
		}
		userInput = req.Metadata["user_input"]

	default:
		r.logger.WarnContext(r.ctx.ctx, "skip handle shadow, model type not support", "modelType", r.ctx.Model.ModelType)
		return
	}

	r.createFile(taskID)
	r.writeMeta(body)

	rc := &domain.RecordParam{
		RequestID:       r.ctx.RequestID,
		TaskID:          taskID,
		UserID:          r.ctx.UserID,
		ModelID:         r.ctx.Model.ID,
		ModelType:       r.ctx.Model.ModelType,
		WorkMode:        mode,
		Prompt:          prompt,
		ProgramLanguage: language,
		Role:            consts.ChatRoleAssistant,
		SourceCode:      sourceCode,
		CursorPosition:  cursorPosition,
		UserInput:       userInput,
	}

	switch tool {
	case "appliedDiff", "editedExistingFile":
		lines := diff.ParseConflictsAndCountLines(code)
		for _, line := range lines {
			rc.CodeLines += int64(line)
		}
	case "newFileCreated":
		rc.CodeLines = int64(strings.Count(code, "\n"))
	}

	ct := r.ctx.RespHeader.Get("Content-Type")
	if strings.Contains(ct, "stream") {
		r.handleStream(rc)
	} else {
		r.handleJson(rc)
	}

	r.logger.
		With("header", formatHeader(r.ctx.Header)).
		With("resp_header", formatHeader(r.ctx.RespHeader)).
		DebugContext(r.ctx.ctx, "handle shadow", "rc", rc)

	if err := r.usecase.Record(context.Background(), rc); err != nil {
		r.logger.With("record", rc).WarnContext(r.ctx.ctx, "记录请求失败", "error", err)
	}
}

func (r *Recorder) writeMeta(body []byte) {
	if r.logFile == nil {
		return
	}

	r.logFile.WriteString("------------------ Request Header ------------------\n")
	for key, value := range formatHeader(r.ctx.Header) {
		r.logFile.WriteString(key + ": " + value + "\n")
	}
	r.logFile.WriteString("------------------ Request Body ------------------\n")
	r.logFile.WriteString(string(body))
	r.logFile.WriteString("\n")
	r.logFile.WriteString("------------------ Response Header ------------------\n")
	for key, value := range formatHeader(r.ctx.RespHeader) {
		r.logFile.WriteString(key + ": " + value + "\n")
	}
	r.logFile.WriteString("------------------ Response Body ------------------\n")
}

func (r *Recorder) createFile(taskID string) {
	if r.cfg.LLMProxy.RequestLogPath == "" {
		return
	}

	dir := filepath.Join(r.cfg.LLMProxy.RequestLogPath, time.Now().Format("2006010215"))
	if err := os.MkdirAll(dir, 0755); err != nil {
		r.logger.WarnContext(r.ctx.ctx, "create dir failed", "error", err)
		return
	}

	id := r.ctx.RequestID
	if taskID != "" {
		id = taskID
	}
	filename := filepath.Join(dir, id+".log")
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		r.logger.WarnContext(r.ctx.ctx, "create file failed", "error", err)
		return
	}
	r.logFile = f
}

func (r *Recorder) handleJson(rc *domain.RecordParam) {
	buffer := strings.Builder{}
	for data := range r.shadown {
		buffer.Write(data)
		if r.logFile != nil {
			r.logFile.Write(data)
		}
	}

	switch rc.ModelType {
	case consts.ModelTypeLLM:
		var resp openai.ChatCompletionResponse
		if err := json.Unmarshal([]byte(buffer.String()), &resp); err != nil {
			r.logger.WarnContext(r.ctx.ctx, "unmarshal chat completion response failed", "error", err)
			return
		}
		if len(resp.Choices) > 0 {
			rc.Completion = resp.Choices[0].Message.Content
			if input := resp.Usage.PromptTokens; input > 0 {
				rc.InputTokens = int64(input)
			}
			if output := resp.Usage.CompletionTokens; output > 0 {
				rc.OutputTokens = int64(output)
			}
		}

	case consts.ModelTypeCoder:
		var resp openai.CompletionResponse
		if err := json.Unmarshal([]byte(buffer.String()), &resp); err != nil {
			r.logger.WarnContext(r.ctx.ctx, "unmarshal completion response failed", "error", err)
			return
		}
		if rc.TaskID == "" {
			rc.TaskID = resp.ID
		}
		if input := resp.Usage.PromptTokens; input > 0 {
			rc.InputTokens = int64(input)
		}
		if output := resp.Usage.CompletionTokens; output > 0 {
			rc.OutputTokens = int64(output)
		}
		if len(resp.Choices) > 0 {
			rc.Completion = resp.Choices[0].Text
			rc.CodeLines = int64(strings.Count(resp.Choices[0].Text, "\n"))
		}
	}
}

func (r *Recorder) handleStream(rc *domain.RecordParam) {
	buffer := strings.Builder{}
	for data := range r.shadown {
		buffer.Write(data)
		cnt := buffer.String()

		if r.logFile != nil {
			r.logFile.Write(data)
		}

		lines := strings.Split(cnt, "\n")
		if len(lines) > 0 {
			lastLine := lines[len(lines)-1]
			lines = lines[:len(lines)-1]
			buffer.Reset()
			buffer.WriteString(lastLine)
		}

		for _, line := range lines {
			if err := r.processSSELine(r.ctx.ctx, line, rc); err != nil {
				r.logger.WarnContext(r.ctx.ctx, "处理SSE行失败", "error", err)
			}
		}
	}
}

func (r *Recorder) processSSELine(ctx context.Context, line string, rc *domain.RecordParam) error {
	line = strings.TrimSpace(line)
	if line == "" || !strings.HasPrefix(line, "data:") {
		return nil
	}

	data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if data == "" {
		return nil
	}

	if data == "[DONE]" {
		return nil
	}

	switch r.ctx.Model.ModelType {
	case consts.ModelTypeLLM:
		var resp openai.ChatCompletionStreamResponse
		if err := json.Unmarshal([]byte(data), &resp); err != nil {
			r.logger.With("model_type", r.ctx.Model.ModelType).With("data", data).WarnContext(ctx, "解析SSE行失败", "error", err)
			return nil
		}
		if resp.Usage != nil {
			if input := resp.Usage.PromptTokens; input > 0 {
				rc.InputTokens = int64(input)
			}
			if output := resp.Usage.CompletionTokens; output > 0 {
				rc.OutputTokens = int64(output)
			}
		}
		if len(resp.Choices) > 0 {
			content := resp.Choices[0].Delta.Content
			if content != "" {
				rc.Completion += content
			}
		}

	case consts.ModelTypeCoder:
		var resp openai.CompletionResponse
		if err := json.Unmarshal([]byte(data), &resp); err != nil {
			r.logger.With("model_type", r.ctx.Model.ModelType).With("data", data).WarnContext(ctx, "解析SSE行失败", "error", err)
			return nil
		}

		if rc.TaskID == "" {
			rc.TaskID = resp.ID
		}
		if input := resp.Usage.PromptTokens; input > 0 {
			rc.InputTokens = int64(input)
		}
		if output := resp.Usage.CompletionTokens; output > 0 {
			rc.OutputTokens = int64(output)
		}
		if len(resp.Choices) > 0 {
			rc.Completion += resp.Choices[0].Text
			rc.CodeLines += int64(strings.Count(resp.Choices[0].Text, "\n"))
		}
	}

	return nil
}

// Close implements io.ReadCloser.
func (r *Recorder) Close() error {
	if r.shadown != nil {
		close(r.shadown)
	}
	if r.logFile != nil {
		r.logFile.Close()
	}
	return r.src.Close()
}

// Read implements io.ReadCloser.
func (r *Recorder) Read(p []byte) (n int, err error) {
	n, err = r.src.Read(p)
	if n > 0 {
		data := make([]byte, n)
		copy(data, p[:n])
		r.shadown <- data
	}
	if err != nil {
		return
	}
	return
}
