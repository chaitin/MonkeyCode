package nls

import (
	"log/slog"

	nls "github.com/aliyun/alibabacloud-nls-go-sdk"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// RecognitionResult 表示语音识别结果
type RecognitionResult struct {
	Text      string `json:"text"`
	IsFinal   bool   `json:"is_final"`  // 是否为最终结果
	UserID    string `json:"user_id"`   // 用户ID
	Timestamp int64  `json:"timestamp"` // 时间戳
}

// SpeechRecognitionResponse 表示语音识别回调的JSON响应
type SpeechRecognitionResponse struct {
	Header  RecognitionHeader  `json:"header"`
	Payload RecognitionPayload `json:"payload"`
}

// RecognitionHeader 表示语音识别响应的头部信息
type RecognitionHeader struct {
	Namespace  string `json:"namespace"`
	Name       string `json:"name"`
	Status     int    `json:"status"`
	MessageID  string `json:"message_id"`
	TaskID     string `json:"task_id"`
	StatusText string `json:"status_text"`
}

// RecognitionPayload 表示语音识别响应的负载信息
type RecognitionPayload struct {
	Result   string `json:"result"`
	Duration int    `json:"duration"`
}

// CallbackParam 回调函数参数结构体
type CallbackParam struct {
	Logger    *nls.NlsLogger
	SessionID string
	ResultCh  chan<- RecognitionResult
	UserID    string
}

// NLS 语音识别服务结构体
type NLS struct {
	redis  *redis.Client
	cfg    *config.Config
	logger *slog.Logger
}
