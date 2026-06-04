// Package asr 提供 ASR (Automatic Speech Recognition) 服务的中性抽象,
// 让上层 handler 无需关心具体厂商 (豆包 / 阿里云 NLS / Whisper 等),
// 通过 Transcriber/Session 接口统一调用流式语音识别。
package asr

// EventType 流式转写事件类型
type EventType string

const (
	EventReady   EventType = "ready"   // session 就绪,客户端可以开始发音频
	EventPartial EventType = "partial" // 句子识别中,text 会反复刷新
	EventFinal   EventType = "final"   // 句子定稿,text 不再变化
	EventDone    EventType = "done"    // session 正常结束
	EventError   EventType = "error"   // 出错(本地校验/远端均使用此事件)
)

// Event 流式转写事件,由 Session.Events() 输出
type Event struct {
	Type      EventType
	Index     int    // partial / final 携带,句子序号,从 1 开始
	Text      string // partial / final 携带
	Logid    string // ready / error 携带,远端 trace id,排障必备
	Error     *Error // error 携带
	Timestamp int64  // 服务端时间(ms)
}

// Error error 事件的详细信息。Code 为厂商错误码;本地校验错误填 0,
// 由 Message 描述原因。RequestID/Logid 用于联调时跟运维/厂商客服关联日志。
type Error struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
	Logid     string `json:"logid,omitempty"`
}

// Param 用户可配的启动参数子集
type Param struct {
	Format     string   // 音频容器格式,具体厂商支持差异由实现层校验
	Disfluency bool     // 顺滑(过滤"嗯/啊"等)
	HotWords   []string // 运行时动态热词,直传通道(双向流式优化版限 100 tokens,超量厂商端会截断)
}
