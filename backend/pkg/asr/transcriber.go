package asr

import (
	"context"

	"github.com/google/uuid"
)

// Transcriber 一个 ASR 服务的客户端工厂,每次 NewSession 启动一次新的流式会话。
type Transcriber interface {
	// NewSession 建立并启动一次流式转写会话。
	// 返回时远端必须已就绪(ready),调用方可立即 SendAudio。
	NewSession(ctx context.Context, userID uuid.UUID, p Param) (Session, error)
}

// Session 一次流式转写会话。事件经 Events() 输出。
type Session interface {
	// SendAudio 向远端透传一帧音频数据。
	SendAudio(data []byte) error

	// Stop 结束 session。幂等,可被并发调用多次。
	Stop() error

	// SessionID 返回本会话的内部 id,便于日志关联。
	SessionID() string

	// Logid 返回远端 trace id (如豆包的 X-Tt-Logid);若远端未提供则返回空。
	Logid() string

	// Events 返回事件只读通道。通道**永不关闭**;消费侧基于
	// EventDone / EventError 或 ctx 退出。
	Events() <-chan Event
}
