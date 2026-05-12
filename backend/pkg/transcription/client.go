package transcription

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// RecognitionResult 表示语音识别结果
type RecognitionResult struct {
	Text      string `json:"text"`
	IsFinal   bool   `json:"is_final"`
	UserID    string `json:"user_id"`
	Timestamp int64  `json:"timestamp"`
}

// Client GPT 转录 API 客户端
type Client struct {
	cfg    *config.Config
	logger *slog.Logger
	http   *http.Client
}

// transcriptEvent SSE 事件
type transcriptEvent struct {
	Type       string `json:"type"`
	Delta      string `json:"delta,omitempty"`
	Text       string `json:"text,omitempty"`
	Logprobs   []any  `json:"logprobs,omitempty"`
}

func NewClient(cfg *config.Config, logger *slog.Logger) *Client {
	return &Client{
		cfg:    cfg,
		logger: logger,
		http: &http.Client{
			Timeout: 2 * time.Minute,
		},
	}
}

// SpeechRecognition 调用 GPT 转录 API，返回流式识别结果
func (c *Client) SpeechRecognition(ctx context.Context, user uuid.UUID, audio []byte) (<-chan RecognitionResult, <-chan error) {
	resultCh := make(chan RecognitionResult, 10)
	errorCh := make(chan error, 1)

	go func() {
		defer close(resultCh)
		defer close(errorCh)

		baseURL := c.cfg.NLS.BaseURL
		apiKey := c.cfg.NLS.APIKey
		model := c.cfg.NLS.Model

		// 构建请求 URL
		reqURL, err := url.JoinPath(strings.TrimSuffix(baseURL, "/"), "audio", "transcriptions")
		if err != nil {
			c.logger.ErrorContext(ctx, "failed to build request URL", "error", err)
			errorCh <- fmt.Errorf("failed to build URL: %w", err)
			return
		}

		c.logger.InfoContext(ctx, "calling transcription API",
			"url", reqURL, "model", model, "audio_size", len(audio))

		// 构建 multipart form
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)

		// 添加音频文件
		part, err := writer.CreateFormFile("file", "audio.wav")
		if err != nil {
			errorCh <- fmt.Errorf("failed to create form file: %w", err)
			return
		}
		if _, err := part.Write(audio); err != nil {
			errorCh <- fmt.Errorf("failed to write audio data: %w", err)
			return
		}

		// 添加参数
		writer.WriteField("model", model)
		writer.WriteField("language", "zh")
		writer.WriteField("response_format", "text")
		writer.WriteField("stream", "true")
		writer.Close()

		// 创建 HTTP 请求
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, body)
		if err != nil {
			errorCh <- fmt.Errorf("failed to create request: %w", err)
			return
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", writer.FormDataContentType())

		// 发送请求
		resp, err := c.http.Do(req)
		if err != nil {
			c.logger.ErrorContext(ctx, "transcription request failed", "error", err)
			errorCh <- fmt.Errorf("request failed: %w", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			respBody, _ := io.ReadAll(resp.Body)
			c.logger.ErrorContext(ctx, "transcription API error",
				"status", resp.StatusCode, "body", string(respBody))
			errorCh <- fmt.Errorf("API error: status %d, body: %s", resp.StatusCode, string(respBody))
			return
		}

		c.logger.InfoContext(ctx, "transcription stream started")

		// 解析 SSE 流
		scanner := bufio.NewScanner(resp.Body)
		var fullText string

		for scanner.Scan() {
			line := scanner.Text()

			// 跳过空行和注释
			if line == "" || strings.HasPrefix(line, ":") {
				continue
			}

			// 解析 SSE data 行
			if !strings.HasPrefix(line, "data: ") {
				continue
			}

			data := strings.TrimPrefix(line, "data: ")

			// 检查流结束标记
			if data == "[DONE]" {
				c.logger.InfoContext(ctx, "transcription stream done", "full_text", fullText)
				break
			}

			var event transcriptEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				c.logger.DebugContext(ctx, "failed to parse SSE event", "data", data, "error", err)
				continue
			}

			c.logger.DebugContext(ctx, "received transcription event", "type", event.Type, "delta", event.Delta)

			switch event.Type {
			case "transcript.text.delta":
				fullText += event.Delta
				result := RecognitionResult{
					Text:      event.Delta,
					IsFinal:   false,
					UserID:    user.String(),
					Timestamp: time.Now().UnixMilli(),
				}
				select {
				case resultCh <- result:
				default:
					c.logger.WarnContext(ctx, "result channel full, skipping delta")
				}

			case "transcript.text.done":
				finalText := event.Text
				if finalText == "" {
					finalText = fullText
				}
				result := RecognitionResult{
					Text:      finalText,
					IsFinal:   true,
					UserID:    user.String(),
					Timestamp: time.Now().UnixMilli(),
				}
				select {
				case resultCh <- result:
				default:
					c.logger.WarnContext(ctx, "result channel full, skipping done")
				}
				c.logger.InfoContext(ctx, "transcription completed", "text", finalText)
				return
			}
		}

		if err := scanner.Err(); err != nil {
			c.logger.ErrorContext(ctx, "error reading SSE stream", "error", err)
			errorCh <- fmt.Errorf("stream read error: %w", err)
		}
	}()

	return resultCh, errorCh
}
