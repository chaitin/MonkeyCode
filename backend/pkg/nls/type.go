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

// TranscriptionEventType 实时长语音转写事件类型
type TranscriptionEventType string

const (
	EventReady         TranscriptionEventType = "ready"
	EventSentenceBegin TranscriptionEventType = "sentence_begin"
	EventPartial       TranscriptionEventType = "partial"
	EventFinal         TranscriptionEventType = "final"
	EventDone          TranscriptionEventType = "done"
	EventError         TranscriptionEventType = "error"
)

// AliyunHeader 阿里云 NLS 响应的 header,用于错误透传
type AliyunHeader struct {
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name,omitempty"`
	Status     int    `json:"status"`
	StatusText string `json:"status_text"`
	TaskID     string `json:"task_id,omitempty"`
	MessageID  string `json:"message_id,omitempty"`
}

// TranscriptionEvent 流式转写事件,由 TranscriptionSession.Events() 输出
type TranscriptionEvent struct {
	Type      TranscriptionEventType
	Index     int           // sentence_begin / partial / final 携带
	Text      string        // partial / final 携带
	Header    *AliyunHeader // error 携带(NLS 透传) / 本地错误使用 status=0
	Timestamp int64         // 服务端时间(ms)
}

// TranscriptionParam 用户可配的启动参数子集
type TranscriptionParam struct {
	Format     string // pcm / wav / opus / speex / amr / mp3 / aac
	SampleRate int    // 8000 / 16000
	Disfluency bool
}

// 阿里云事件 payload 的解析结构
type transcriptionResp struct {
	Header  AliyunHeader               `json:"header"`
	Payload transcriptionRespPayload   `json:"payload"`
}

type transcriptionRespPayload struct {
	Index  int    `json:"index"`
	Time   int    `json:"time"`
	Result string `json:"result"`
}
