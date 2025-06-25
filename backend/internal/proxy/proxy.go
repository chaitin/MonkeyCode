package proxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rokku-c/go-openai"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// ErrResp 错误响应
type ErrResp struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code,omitempty"`
	} `json:"error"`
}

// RequestResponseLog 请求响应日志结构
type RequestResponseLog struct {
	Timestamp      time.Time           `json:"timestamp"`
	RequestID      string              `json:"request_id"`
	Endpoint       string              `json:"endpoint"`
	ModelName      string              `json:"model_name"`
	ModelType      consts.ModelType    `json:"model_type"`
	UpstreamURL    string              `json:"upstream_url"`
	RequestBody    any                 `json:"request_body"`
	RequestHeader  map[string][]string `json:"request_header"`
	StatusCode     int                 `json:"status_code"`
	ResponseBody   any                 `json:"response_body"`
	ResponseHeader map[string][]string `json:"response_header"`
	Latency        int64               `json:"latency_ms"`
	Error          string              `json:"error,omitempty"`
	IsStream       bool                `json:"is_stream"`
	SourceIP       string              `json:"source_ip"` // 请求来源IP地址
}

// LLMProxy LLM API代理实现
type LLMProxy struct {
	usecase        domain.ProxyUsecase
	cfg            *config.Config
	client         *http.Client
	logger         *slog.Logger
	requestLogPath string // 请求日志保存路径
}

// NewLLMProxy 创建LLM API代理实例
func NewLLMProxy(
	usecase domain.ProxyUsecase,
	cfg *config.Config,
	logger *slog.Logger,
) domain.Proxy {
	// 解析超时时间
	timeout, err := time.ParseDuration(cfg.LLMProxy.Timeout)
	if err != nil {
		timeout = 30 * time.Second
		logger.Warn("解析超时时间失败, 使用默认值 30s", "error", err)
	}

	// 解析保持连接时间
	keepAlive, err := time.ParseDuration(cfg.LLMProxy.KeepAlive)
	if err != nil {
		keepAlive = 60 * time.Second
		logger.Warn("解析保持连接时间失败, 使用默认值 60s", "error", err)
	}

	// 创建HTTP客户端
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			MaxIdleConns:          cfg.LLMProxy.ClientPoolSize,
			MaxConnsPerHost:       cfg.LLMProxy.ClientPoolSize,
			MaxIdleConnsPerHost:   cfg.LLMProxy.ClientPoolSize,
			IdleConnTimeout:       keepAlive,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			DisableCompression:    false,
			ForceAttemptHTTP2:     true,
		},
	}

	// 获取日志配置
	requestLogPath := ""
	if cfg.LLMProxy.RequestLogPath != "" {
		requestLogPath = cfg.LLMProxy.RequestLogPath
		// 确保目录存在
		if err := os.MkdirAll(requestLogPath, 0755); err != nil {
			logger.Warn("创建请求日志目录失败", "error", err, "path", requestLogPath)
		}
	}

	return &LLMProxy{
		usecase:        usecase,
		client:         client,
		cfg:            cfg,
		requestLogPath: requestLogPath,
		logger:         logger,
	}
}

// saveRequestResponseLog 保存请求响应日志到文件
func (p *LLMProxy) saveRequestResponseLog(log *RequestResponseLog) {
	if p.requestLogPath == "" {
		return
	}

	// 创建文件名，格式：YYYYMMDD_HHMMSS_请求ID.json
	timestamp := log.Timestamp.Format("20060102_150405") + fmt.Sprintf("_%03d", log.Timestamp.Nanosecond()/1e6)
	filename := fmt.Sprintf("%s_%s.json", timestamp, log.RequestID)
	filepath := filepath.Join(p.requestLogPath, filename)

	// 将日志序列化为JSON
	logData, err := json.MarshalIndent(log, "", "  ")
	if err != nil {
		p.logger.Error("序列化请求日志失败", "error", err)
		return
	}

	// 写入文件
	if err := os.WriteFile(filepath, logData, 0644); err != nil {
		p.logger.Error("写入请求日志文件失败", "error", err, "path", filepath)
		return
	}

	p.logger.Debug("请求响应日志已保存", "path", filepath)
}

func (p *LLMProxy) AcceptCompletion(ctx context.Context, req *domain.AcceptCompletionReq) error {
	return p.usecase.AcceptCompletion(ctx, req)
}

func writeErrResp(w http.ResponseWriter, code int, message, errorType string) {
	resp := ErrResp{
		Error: struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code,omitempty"`
		}{
			Message: message,
			Type:    errorType,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	b, _ := json.Marshal(resp)
	w.Write(b)
}

type Ctx struct {
	UserID    string
	RequestID string
	SourceIP  string
}

func (p *LLMProxy) handle(ctx context.Context, fn func(ctx *Ctx, log *RequestResponseLog) error) {
	// 获取用户ID
	userID := "unknown"
	if id, ok := ctx.Value(logger.UserIDKey).(string); ok {
		userID = id
	}

	requestID := "unknown"
	if id, ok := ctx.Value(logger.RequestIDKey).(string); ok {
		requestID = id
	}

	sourceip := "unknown"
	if ip, ok := ctx.Value("remote_addr").(string); ok {
		sourceip = ip
	}

	// 创建请求日志结构
	l := &RequestResponseLog{
		Timestamp: time.Now(),
		RequestID: requestID,
		ModelType: consts.ModelTypeCoder,
		SourceIP:  sourceip,
	}

	c := &Ctx{
		UserID:    userID,
		RequestID: requestID,
		SourceIP:  sourceip,
	}

	if err := fn(c, l); err != nil {
		p.logger.With("userID", userID, "requestID", requestID, "sourceip", sourceip).ErrorContext(ctx, "处理请求失败", "error", err)
		l.Error = err.Error()
	}

	p.saveRequestResponseLog(l)
}

func (p *LLMProxy) HandleCompletion(ctx context.Context, w http.ResponseWriter, req domain.CompletionRequest) {
	if req.Stream {
		p.handleCompletionStream(ctx, w, req)
	} else {
		p.handleCompletion(ctx, w, req)
	}
}

func (p *LLMProxy) handleCompletionStream(ctx context.Context, w http.ResponseWriter, req domain.CompletionRequest) {
	endpoint := "/completions"
	p.handle(ctx, func(c *Ctx, log *RequestResponseLog) error {
		// 使用负载均衡算法选择模型
		m, err := p.usecase.SelectModelWithLoadBalancing(req.Model, consts.ModelTypeCoder)
		if err != nil {
			p.logger.With("modelName", req.Model, "modelType", consts.ModelTypeCoder).WarnContext(ctx, "模型选择失败", "error", err)
			writeErrResp(w, http.StatusNotFound, "模型未找到", "proxy_error")
			return err
		}

		// 构造上游API URL
		upstream := m.APIBase + endpoint
		log.UpstreamURL = upstream
		startTime := time.Now()

		// 创建上游请求
		body, err := json.Marshal(req)
		if err != nil {
			p.logger.ErrorContext(ctx, "序列化请求体失败", "error", err)
			return fmt.Errorf("序列化请求体失败: %w", err)
		}

		upreq, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream, bytes.NewReader(body))
		if err != nil {
			p.logger.With("upstream", upstream).WarnContext(ctx, "创建上游流式请求失败", "error", err)
			return fmt.Errorf("创建上游请求失败: %w", err)
		}

		// 设置请求头
		upreq.Header.Set("Content-Type", "application/json")
		upreq.Header.Set("Accept", "text/event-stream")
		if m.APIKey != "" && m.APIKey != "none" {
			upreq.Header.Set("Authorization", "Bearer "+m.APIKey)
		}

		// 保存请求头（去除敏感信息）
		requestHeaders := make(map[string][]string)
		for k, v := range upreq.Header {
			if k != "Authorization" {
				requestHeaders[k] = v
			} else {
				// 敏感信息脱敏
				requestHeaders[k] = []string{"Bearer ***"}
			}
		}
		log.RequestHeader = requestHeaders

		p.logger.With(
			"upstreamURL", upstream,
			"modelName", m.ModelName,
			"modelType", consts.ModelTypeLLM,
			"apiBase", m.APIBase,
			"requestHeader", upreq.Header,
			"requestBody", upreq,
		).DebugContext(ctx, "转发流式请求到上游API")

		// 发送请求
		resp, err := p.client.Do(upreq)
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "发送上游流式请求失败", "error", err)
			return fmt.Errorf("发送上游请求失败: %w", err)
		}
		defer resp.Body.Close()

		// 检查响应状态
		if resp.StatusCode != http.StatusOK {
			responseBody, _ := io.ReadAll(resp.Body)

			// 更新日志错误信息
			log.StatusCode = resp.StatusCode
			log.ResponseHeader = resp.Header
			log.ResponseBody = string(responseBody)
			log.Latency = time.Since(startTime).Milliseconds()

			// 在debug级别记录错误的流式响应内容
			p.logger.With(
				"statusCode", resp.StatusCode,
				"responseHeader", resp.Header,
				"responseBody", string(responseBody),
			).DebugContext(ctx, "上游流式响应错误原始内容")

			var errorResp ErrResp
			if err := json.Unmarshal(responseBody, &errorResp); err == nil {
				p.logger.With(
					"endpoint", endpoint,
					"upstreamURL", upstream,
					"requestBody", upreq,
					"statusCode", resp.StatusCode,
					"errorType", errorResp.Error.Type,
					"errorCode", errorResp.Error.Code,
					"errorMessage", errorResp.Error.Message,
					"latency", time.Since(startTime),
				).WarnContext(ctx, "上游API流式请求异常详情")

				return fmt.Errorf("上游API返回错误: %s", errorResp.Error.Message)
			}

			p.logger.With(
				"endpoint", endpoint,
				"upstreamURL", upstream,
				"requestBody", upreq,
				"statusCode", resp.StatusCode,
				"responseBody", string(responseBody),
			).WarnContext(ctx, "上游API流式请求异常详情")

			return fmt.Errorf("上游API返回非200状态码: %d, 响应: %s", resp.StatusCode, string(responseBody))
		}

		// 更新日志信息
		log.StatusCode = resp.StatusCode
		log.ResponseHeader = resp.Header

		// 在debug级别记录流式响应头信息
		p.logger.With(
			"statusCode", resp.StatusCode,
			"responseHeader", resp.Header,
		).DebugContext(ctx, "上游流式响应头信息")

		// 设置响应头
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Transfer-Encoding", "chunked")

		rc := &domain.RecordParam{
			UserID:    c.UserID,
			ModelID:   m.ID,
			ModelType: consts.ModelTypeLLM,
			Prompt:    req.Prompt.(string),
		}
		buf := bufio.NewWriterSize(w, 32*1024)
		defer buf.Flush()

		ch := make(chan []byte, 1024)
		defer close(ch)

		go func(rc *domain.RecordParam) {
			for line := range ch {
				if bytes.HasPrefix(line, []byte("data:")) {
					line = bytes.TrimPrefix(line, []byte("data: "))
					line = bytes.TrimSpace(line)
					if len(line) == 0 {
						continue
					}

					if bytes.Equal(line, []byte("[DONE]")) {
						break
					}

					var t openai.CompletionResponse
					if err := json.Unmarshal(line, &t); err != nil {
						p.logger.With("line", string(line)).WarnContext(ctx, "解析流式数据失败", "error", err)
						continue
					}

					p.logger.With("response", t).DebugContext(ctx, "流式响应数据")
					if len(t.Choices) > 0 {
						rc.Completion += t.Choices[0].Text
					}
					rc.InputTokens += int64(t.Usage.PromptTokens)
					rc.OutputTokens += int64(t.Usage.CompletionTokens)
				}
			}

			p.logger.With("record", rc).DebugContext(ctx, "流式记录")
			if err := p.usecase.Record(context.Background(), rc); err != nil {
				p.logger.With("modelID", m.ID, "modelName", m.ModelName, "modelType", consts.ModelTypeLLM).
					WarnContext(ctx, "插入流式记录失败", "error", err)
			}
		}(rc)

		err = streamRead(ctx, resp.Body, func(line []byte) error {
			ch <- line
			if _, err := buf.Write(line); err != nil {
				return fmt.Errorf("写入响应失败: %w", err)
			}
			return buf.Flush()
		})
		return err
	})
}

func (p *LLMProxy) handleCompletion(ctx context.Context, w http.ResponseWriter, req domain.CompletionRequest) {
	endpoint := "/completions"
	p.handle(ctx, func(c *Ctx, log *RequestResponseLog) error {
		// 使用负载均衡算法选择模型
		m, err := p.usecase.SelectModelWithLoadBalancing(req.Model, consts.ModelTypeCoder)
		if err != nil {
			p.logger.With("modelName", req.Model, "modelType", consts.ModelTypeCoder).WarnContext(ctx, "模型选择失败", "error", err)
			writeErrResp(w, http.StatusNotFound, "模型未找到", "proxy_error")
			return err
		}

		// 构造上游API URL
		upstream := m.APIBase + endpoint
		log.UpstreamURL = upstream
		u, err := url.Parse(upstream)
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "解析上游URL失败", "error", err)
			writeErrResp(w, http.StatusInternalServerError, "无效的上游URL", "proxy_error")
			return err
		}

		startTime := time.Now()

		client := request.NewClient(u.Scheme, u.Host, 30*time.Second)
		client.SetDebug(p.cfg.Debug)
		resp, err := request.Post[openai.CompletionResponse](client, u.Path, req, request.WithHeader(request.Header{
			"Authorization": "Bearer " + m.APIKey,
		}))
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "发送上游请求失败", "error", err)
			writeErrResp(w, http.StatusInternalServerError, "发送上游请求失败", "proxy_error")
			log.Latency = time.Since(startTime).Milliseconds()
			return err
		}

		latency := time.Since(startTime)

		// 记录请求信息
		p.logger.With(
			"statusCode", http.StatusOK,
			"upstreamURL", upstream,
			"modelName", req.Model,
			"modelType", consts.ModelTypeCoder,
			"apiBase", m.APIBase,
			"requestBody", req,
			"resp", resp,
			"latency", latency.String(),
		).DebugContext(ctx, "转发请求到上游API")

		go p.recordCompletion(c, m.ID, req, resp)

		// 更新请求日志
		log.StatusCode = http.StatusOK
		log.ResponseBody = resp
		log.ResponseHeader = resp.Header()
		log.Latency = latency.Milliseconds()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		b, err := json.Marshal(resp)
		if err != nil {
			p.logger.With("response", resp).WarnContext(ctx, "序列化响应失败", "error", err)
			return err
		}
		w.Write(b)
		return nil
	})
}

func (p *LLMProxy) recordCompletion(c *Ctx, modelID string, req domain.CompletionRequest, resp *openai.CompletionResponse) {
	ctx := context.Background()
	prompt := req.Prompt.(string)
	rc := &domain.RecordParam{
		TaskID:          resp.ID,
		UserID:          c.UserID,
		ModelID:         modelID,
		ModelType:       consts.ModelTypeCoder,
		Prompt:          prompt,
		ProgramLanguage: req.Metadata["program_language"],
		InputTokens:     int64(resp.Usage.PromptTokens),
		OutputTokens:    int64(resp.Usage.CompletionTokens),
	}

	for _, choice := range resp.Choices {
		rc.Completion += choice.Text
	}
	lines := strings.Count(rc.Completion, "\n") + 1
	rc.CodeLines = int64(lines)

	if err := p.usecase.Record(ctx, rc); err != nil {
		p.logger.With("modelID", modelID, "modelName", req.Model, "modelType", consts.ModelTypeCoder).WarnContext(ctx, "记录请求失败", "error", err)
	}
}

func (p *LLMProxy) HandleChatCompletion(ctx context.Context, w http.ResponseWriter, req *openai.ChatCompletionRequest) {
	if req.Stream {
		p.handleChatCompletionStream(ctx, w, req)
	} else {
		p.handleChatCompletion(ctx, w, req)
	}
}

func streamRead(ctx context.Context, r io.Reader, fn func([]byte) error) error {
	reader := bufio.NewReaderSize(r, 32*1024)
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("流式请求被取消: %w", ctx.Err())
		default:
			line, err := reader.ReadBytes('\n')
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return fmt.Errorf("读取流式数据失败: %w", err)
			}

			line = bytes.TrimSpace(line)
			if len(line) == 0 {
				continue
			}

			line = append(line, '\n')
			line = append(line, '\n')

			fn(line)
		}
	}
}

func (p *LLMProxy) handleChatCompletionStream(ctx context.Context, w http.ResponseWriter, req *openai.ChatCompletionRequest) {
	endpoint := "/chat/completions"
	p.handle(ctx, func(c *Ctx, log *RequestResponseLog) error {
		// 记录开始时间用于性能监控
		startTime := time.Now()

		// 使用负载均衡算法选择模型
		m, err := p.usecase.SelectModelWithLoadBalancing(req.Model, consts.ModelTypeLLM)
		if err != nil {
			p.logger.With("modelName", req.Model, "modelType", consts.ModelTypeLLM).WarnContext(ctx, "流式请求模型选择失败", "error", err)
			writeErrResp(w, http.StatusNotFound, "模型未找到", "proxy_error")
			return err
		}

		prompt := req.Metadata["message"]
		workMode := req.Metadata["work_mode"]
		taskID := req.Metadata["task_id"]

		// 构造上游API URL
		upstream := m.APIBase + endpoint
		log.UpstreamURL = upstream

		// 创建上游请求
		body, err := json.Marshal(req)
		if err != nil {
			p.logger.ErrorContext(ctx, "序列化请求体失败", "error", err)
			return fmt.Errorf("序列化请求体失败: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream, bytes.NewReader(body))
		if err != nil {
			p.logger.With("upstream", upstream).WarnContext(ctx, "创建上游流式请求失败", "error", err)
			return fmt.Errorf("创建上游请求失败: %w", err)
		}

		// 设置请求头
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		if m.APIKey != "" && m.APIKey != "none" {
			req.Header.Set("Authorization", "Bearer "+m.APIKey)
		}

		// 保存请求头（去除敏感信息）
		requestHeaders := make(map[string][]string)
		for k, v := range req.Header {
			if k != "Authorization" {
				requestHeaders[k] = v
			} else {
				// 敏感信息脱敏
				requestHeaders[k] = []string{"Bearer ***"}
			}
		}
		log.RequestHeader = requestHeaders

		p.logger.With(
			"upstreamURL", upstream,
			"modelName", m.ModelName,
			"modelType", consts.ModelTypeLLM,
			"apiBase", m.APIBase,
			"work_mode", workMode,
			"requestHeader", req.Header,
			"requestBody", req,
			"taskID", taskID,
		).DebugContext(ctx, "转发流式请求到上游API")

		// 发送请求
		resp, err := p.client.Do(req)
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "发送上游流式请求失败", "error", err)
			return fmt.Errorf("发送上游请求失败: %w", err)
		}
		defer resp.Body.Close()

		// 检查响应状态
		if resp.StatusCode != http.StatusOK {
			responseBody, _ := io.ReadAll(resp.Body)

			// 更新日志错误信息
			log.StatusCode = resp.StatusCode
			log.ResponseHeader = resp.Header
			log.ResponseBody = string(responseBody)
			log.Latency = time.Since(startTime).Milliseconds()

			// 在debug级别记录错误的流式响应内容
			p.logger.With(
				"statusCode", resp.StatusCode,
				"responseHeader", resp.Header,
				"responseBody", string(responseBody),
			).DebugContext(ctx, "上游流式响应错误原始内容")

			var errorResp ErrResp
			if err := json.Unmarshal(responseBody, &errorResp); err == nil {
				p.logger.With(
					"endpoint", endpoint,
					"upstreamURL", upstream,
					"requestBody", req,
					"statusCode", resp.StatusCode,
					"errorType", errorResp.Error.Type,
					"errorCode", errorResp.Error.Code,
					"errorMessage", errorResp.Error.Message,
					"latency", time.Since(startTime),
				).WarnContext(ctx, "上游API流式请求异常详情")

				return fmt.Errorf("上游API返回错误: %s", errorResp.Error.Message)
			}

			p.logger.With(
				"endpoint", endpoint,
				"upstreamURL", upstream,
				"requestBody", req,
				"statusCode", resp.StatusCode,
				"responseBody", string(responseBody),
			).WarnContext(ctx, "上游API流式请求异常详情")

			return fmt.Errorf("上游API返回非200状态码: %d, 响应: %s", resp.StatusCode, string(responseBody))
		}

		// 更新日志信息
		log.StatusCode = resp.StatusCode
		log.ResponseHeader = resp.Header

		// 在debug级别记录流式响应头信息
		p.logger.With(
			"statusCode", resp.StatusCode,
			"responseHeader", resp.Header,
		).DebugContext(ctx, "上游流式响应头信息")

		// 设置响应头
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Transfer-Encoding", "chunked")

		rc := &domain.RecordParam{
			UserID:    c.UserID,
			ModelID:   m.ID,
			ModelType: consts.ModelTypeLLM,
			WorkMode:  workMode,
			Prompt:    prompt,
			TaskID:    taskID,
		}
		buf := bufio.NewWriterSize(w, 32*1024)
		defer buf.Flush()

		ch := make(chan []byte, 1024)
		defer close(ch)

		go func(rc *domain.RecordParam) {
			for line := range ch {
				if bytes.HasPrefix(line, []byte("data:")) {
					line = bytes.TrimPrefix(line, []byte("data: "))
					line = bytes.TrimSpace(line)
					if len(line) == 0 {
						continue
					}

					if bytes.Equal(line, []byte("[DONE]")) {
						break
					}

					var t openai.ChatCompletionStreamResponse
					if err := json.Unmarshal(line, &t); err != nil {
						p.logger.With("line", string(line)).WarnContext(ctx, "解析流式数据失败", "error", err)
						continue
					}

					p.logger.With("response", t).DebugContext(ctx, "流式响应数据")
					if len(t.Choices) > 0 {
						rc.Completion += t.Choices[0].Delta.Content
					}
					if t.Usage != nil {
						rc.InputTokens += int64(t.Usage.PromptTokens)
						rc.OutputTokens += int64(t.Usage.CompletionTokens)
					}
				}
			}

			p.logger.With("record", rc).DebugContext(ctx, "流式记录")
			if err := p.usecase.Record(context.Background(), rc); err != nil {
				p.logger.With("modelID", m.ID, "modelName", m.ModelName, "modelType", consts.ModelTypeLLM).
					WarnContext(ctx, "插入流式记录失败", "error", err)
			}
		}(rc)

		err = streamRead(ctx, resp.Body, func(line []byte) error {
			ch <- line
			if _, err := buf.Write(line); err != nil {
				return fmt.Errorf("写入响应失败: %w", err)
			}
			return buf.Flush()
		})
		return err
	})
}

func (p *LLMProxy) handleChatCompletion(ctx context.Context, w http.ResponseWriter, req *openai.ChatCompletionRequest) {
	endpoint := "/chat/completions"
	p.handle(ctx, func(c *Ctx, log *RequestResponseLog) error {
		// 使用负载均衡算法选择模型
		m, err := p.usecase.SelectModelWithLoadBalancing(req.Model, consts.ModelTypeCoder)
		if err != nil {
			p.logger.With("modelName", req.Model, "modelType", consts.ModelTypeCoder).WarnContext(ctx, "模型选择失败", "error", err)
			writeErrResp(w, http.StatusNotFound, "模型未找到", "proxy_error")
			return err
		}

		// 构造上游API URL
		upstream := m.APIBase + endpoint
		log.UpstreamURL = upstream
		u, err := url.Parse(upstream)
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "解析上游URL失败", "error", err)
			writeErrResp(w, http.StatusInternalServerError, "无效的上游URL", "proxy_error")
			return err
		}

		startTime := time.Now()
		prompt := req.Metadata["message"]
		workMode := req.Metadata["work_mode"]
		taskID := req.Metadata["task_id"]

		client := request.NewClient(u.Scheme, u.Host, 30*time.Second)
		resp, err := request.Post[openai.ChatCompletionResponse](client, u.Path, req, request.WithHeader(request.Header{
			"Authorization": "Bearer " + m.APIKey,
		}))
		if err != nil {
			p.logger.With("upstreamURL", upstream).WarnContext(ctx, "发送上游请求失败", "error", err)
			writeErrResp(w, http.StatusInternalServerError, "发送上游请求失败", "proxy_error")
			log.Latency = time.Since(startTime).Milliseconds()
			return err
		}

		// 记录请求信息
		p.logger.With(
			"upstreamURL", upstream,
			"modelName", req.Model,
			"modelType", consts.ModelTypeCoder,
			"apiBase", m.APIBase,
			"requestBody", req,
		).DebugContext(ctx, "转发请求到上游API")

		go func() {
			rc := &domain.RecordParam{
				TaskID:          taskID,
				UserID:          c.UserID,
				Prompt:          prompt,
				WorkMode:        workMode,
				ModelID:         m.ID,
				ModelType:       m.ModelType,
				InputTokens:     int64(resp.Usage.PromptTokens),
				OutputTokens:    int64(resp.Usage.CompletionTokens),
				ProgramLanguage: req.Metadata["program_language"],
			}

			for _, choice := range resp.Choices {
				rc.Completion += choice.Message.Content + "\n\n"
			}

			p.logger.With("record", rc).DebugContext(ctx, "记录")

			if err := p.usecase.Record(ctx, rc); err != nil {
				p.logger.With("modelID", m.ID, "modelName", req.Model, "modelType", consts.ModelTypeCoder).WarnContext(ctx, "记录请求失败", "error", err)
			}
		}()

		// 计算请求耗时
		latency := time.Since(startTime)

		// 更新请求日志
		log.StatusCode = http.StatusOK
		log.ResponseBody = resp
		log.ResponseHeader = resp.Header()
		log.Latency = latency.Milliseconds()

		// 记录响应状态
		p.logger.With(
			"statusCode", http.StatusOK,
			"responseHeader", resp.Header(),
			"responseBody", resp,
			"latency", latency.String(),
		).DebugContext(ctx, "上游API响应")

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		b, err := json.Marshal(resp)
		if err != nil {
			p.logger.With("response", resp).WarnContext(ctx, "序列化响应失败", "error", err)
			return err
		}
		w.Write(b)
		return nil
	})
}

func (p *LLMProxy) HandleEmbeddings(ctx context.Context, w http.ResponseWriter, req *openai.EmbeddingRequest) {
}
