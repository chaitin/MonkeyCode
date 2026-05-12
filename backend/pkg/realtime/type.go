package realtime

import (
	"log/slog"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// RecognitionResult 表示语音识别结果
type RecognitionResult struct {
	Text      string `json:"text"`
	IsFinal   bool   `json:"is_final"`  // 是否为最终结果
	UserID    string `json:"user_id"`   // 用户ID
	Timestamp int64  `json:"timestamp"` // 时间戳
}

// RealtimeClient OpenAI Realtime API 客户端
type RealtimeClient struct {
	cfg    *config.Config
	logger *slog.Logger
}

// SessionUpdateRequest 会话更新请求
type SessionUpdateRequest struct {
	Type    string         `json:"type"`
	Session SessionConfig  `json:"session"`
}

// SessionConfig 会话配置
type SessionConfig struct {
	Type  string       `json:"type"`
	Audio AudioConfig  `json:"audio"`
}

// AudioConfig 音频配置
type AudioConfig struct {
	Input AudioInputConfig `json:"input"`
}

// AudioInputConfig 音频输入配置
type AudioInputConfig struct {
	Format         AudioFormat         `json:"format"`
	Transcription  TranscriptionConfig `json:"transcription"`
	TurnDetection  *TurnDetectionConfig `json:"turn_detection,omitempty"`
}

// AudioFormat 音频格式
type AudioFormat struct {
	Type string `json:"type"`
	Rate int    `json:"rate"`
}

// TranscriptionConfig 转录配置
type TranscriptionConfig struct {
	Model    string `json:"model"`
	Language string `json:"language,omitempty"`
}

// TurnDetectionConfig 语音活动检测配置
type TurnDetectionConfig struct {
	Type              string `json:"type"`
	Threshold         float64 `json:"threshold"`
	PrefixPaddingMs   int    `json:"prefix_padding_ms"`
	SilenceDurationMs int    `json:"silence_duration_ms"`
}

// InputAudioBufferAppend 音频数据追加请求
type InputAudioBufferAppend struct {
	Type  string `json:"type"`
	Audio string `json:"audio"` // base64 编码的 PCM 数据
}

// InputAudioBufferCommit 音频缓冲区提交请求
type InputAudioBufferCommit struct {
	Type string `json:"type"`
}

// TranscriptionDeltaEvent 增量转录事件
type TranscriptionDeltaEvent struct {
	Type         string `json:"type"`
	ItemID       string `json:"item_id"`
	ContentIndex int    `json:"content_index"`
	Delta        string `json:"delta"`
}

// TranscriptionCompletedEvent 转录完成事件
type TranscriptionCompletedEvent struct {
	Type         string `json:"type"`
	ItemID       string `json:"item_id"`
	ContentIndex int    `json:"content_index"`
	Transcript   string `json:"transcript"`
}

// ErrorEvent 错误事件
type ErrorEvent struct {
	Type  string     `json:"type"`
	Error ErrorDetail `json:"error"`
}

// ErrorDetail 错误详情
type ErrorDetail struct {
	Type    string `json:"type"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}
