package realtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// audioChunkSize 每次发送的音频块大小（base64 编码前），约 32KB
const audioChunkSize = 32 * 1024

func NewRealtimeClient(cfg *config.Config, logger *slog.Logger) *RealtimeClient {
	return &RealtimeClient{
		cfg:    cfg,
		logger: logger,
	}
}

// buildWebSocketURL 根据 HTTP base URL 构建 WebSocket URL
func buildWebSocketURL(baseURL, model string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("invalid base URL: %w", err)
	}

	// 切换协议
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "wss", "ws":
		// 已经是 WebSocket 协议
	default:
		return "", fmt.Errorf("unsupported scheme: %s", u.Scheme)
	}

	// 规范化路径：移除尾部斜杠，确保以 /v1/realtime 结尾
	u.Path = strings.TrimSuffix(u.Path, "/")
	u.Path = strings.TrimSuffix(u.Path, "/v1")
	u.Path = u.Path + "/v1/realtime"

	// 设置 query 参数
	q := u.Query()
	q.Set("model", model)
	u.RawQuery = q.Encode()

	return u.String(), nil
}

func (r *RealtimeClient) SpeechRecognition(ctx context.Context, user uuid.UUID, audio []byte) (<-chan RecognitionResult, <-chan error) {
	resultCh := make(chan RecognitionResult, 10)
	errorCh := make(chan error, 1)

	go func() {
		defer close(resultCh)
		defer close(errorCh)

		// 从配置文件读取
		baseURL := r.cfg.GPT.BaseURL
		apiKey := r.cfg.GPT.APIKey
		model := r.cfg.GPT.Model

		// 构建 WebSocket URL
		wsURL, err := buildWebSocketURL(baseURL, model)
		if err != nil {
			r.logger.ErrorContext(ctx, "failed to build WebSocket URL", "error", err)
			errorCh <- fmt.Errorf("failed to build WebSocket URL: %w", err)
			return
		}

		r.logger.InfoContext(ctx, "connecting to realtime API", "url", wsURL)

		// 建立 WebSocket 连接
		header := http.Header{}
		header.Set("Authorization", "Bearer "+apiKey)
		header.Set("OpenAI-Beta", "realtime=v1")

		conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
		if err != nil {
			r.logger.ErrorContext(ctx, "failed to connect to realtime API", "error", err)
			errorCh <- fmt.Errorf("failed to connect: %w", err)
			return
		}
		defer conn.Close()

		// 发送会话配置
		sessionUpdate := SessionUpdateRequest{
			Type: "session.update",
			Session: SessionConfig{
				Type: "transcription",
				Audio: AudioConfig{
					Input: AudioInputConfig{
						Format: AudioFormat{
							Type: "audio/pcm",
							Rate: 24000,
						},
						Transcription: TranscriptionConfig{
							Model:    model,
							Language: "zh",
						},
						TurnDetection: nil, // 手动提交
					},
				},
			},
		}

		if err := conn.WriteJSON(sessionUpdate); err != nil {
			r.logger.ErrorContext(ctx, "failed to send session update", "error", err)
			errorCh <- fmt.Errorf("failed to send session update: %w", err)
			return
		}

		r.logger.InfoContext(ctx, "session configured, sending audio data", "size", len(audio))

		// 分块发送音频数据
		for offset := 0; offset < len(audio); offset += audioChunkSize {
			end := offset + audioChunkSize
			if end > len(audio) {
				end = len(audio)
			}
			chunk := audio[offset:end]
			chunkBase64 := base64.StdEncoding.EncodeToString(chunk)

			appendMsg := InputAudioBufferAppend{
				Type:  "input_audio_buffer.append",
				Audio: chunkBase64,
			}

			if err := conn.WriteJSON(appendMsg); err != nil {
				r.logger.ErrorContext(ctx, "failed to send audio chunk", "error", err, "offset", offset)
				errorCh <- fmt.Errorf("failed to send audio chunk: %w", err)
				return
			}
		}

		// 提交音频缓冲区
		commitMsg := InputAudioBufferCommit{
			Type: "input_audio_buffer.commit",
		}

		if err := conn.WriteJSON(commitMsg); err != nil {
			r.logger.ErrorContext(ctx, "failed to commit audio buffer", "error", err)
			errorCh <- fmt.Errorf("failed to commit audio: %w", err)
			return
		}

		r.logger.InfoContext(ctx, "audio sent, waiting for transcription results")

		// 接收转录结果
		timeout := time.After(2 * time.Minute)
		done := make(chan struct{})

		go func() {
			defer close(done)
			for {
				_, message, err := conn.ReadMessage()
				if err != nil {
					r.logger.ErrorContext(ctx, "failed to read message", "error", err)
					errorCh <- fmt.Errorf("failed to read message: %w", err)
					return
				}

				var event map[string]interface{}
				if err := json.Unmarshal(message, &event); err != nil {
					r.logger.ErrorContext(ctx, "failed to parse event", "error", err)
					continue
				}

				eventType, ok := event["type"].(string)
				if !ok {
					continue
				}

				r.logger.DebugContext(ctx, "received event", "type", eventType, "data", string(message))

				switch eventType {
				case "conversation.item.input_audio_transcription.delta":
					var deltaEvent TranscriptionDeltaEvent
					if err := json.Unmarshal(message, &deltaEvent); err != nil {
						r.logger.ErrorContext(ctx, "failed to parse delta event", "error", err)
						continue
					}

					result := RecognitionResult{
						Text:      deltaEvent.Delta,
						IsFinal:   false,
						UserID:    user.String(),
						Timestamp: time.Now().UnixMilli(),
					}

					select {
					case resultCh <- result:
					default:
						r.logger.WarnContext(ctx, "result channel full, skipping delta")
					}

				case "conversation.item.input_audio_transcription.completed":
					var completedEvent TranscriptionCompletedEvent
					if err := json.Unmarshal(message, &completedEvent); err != nil {
						r.logger.ErrorContext(ctx, "failed to parse completed event", "error", err)
						continue
					}

					result := RecognitionResult{
						Text:      completedEvent.Transcript,
						IsFinal:   true,
						UserID:    user.String(),
						Timestamp: time.Now().UnixMilli(),
					}

					select {
					case resultCh <- result:
					default:
						r.logger.WarnContext(ctx, "result channel full, skipping completed")
					}

					r.logger.InfoContext(ctx, "transcription completed", "transcript", completedEvent.Transcript)
					return

				case "error":
					var errorEvent ErrorEvent
					if err := json.Unmarshal(message, &errorEvent); err != nil {
						r.logger.ErrorContext(ctx, "failed to parse error event", "error", err)
						errorCh <- fmt.Errorf("unknown error")
						return
					}

					r.logger.ErrorContext(ctx, "received error event", "error", errorEvent.Error.Message)
					errorCh <- fmt.Errorf("transcription error: %s", errorEvent.Error.Message)
					return
				}
			}
		}()

		select {
		case <-done:
			return
		case <-timeout:
			r.logger.WarnContext(ctx, "transcription timeout")
			errorCh <- fmt.Errorf("transcription timeout")
			return
		case <-ctx.Done():
			r.logger.InfoContext(ctx, "context cancelled")
			return
		}
	}()

	return resultCh, errorCh
}
