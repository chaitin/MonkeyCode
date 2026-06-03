package nls

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"

	nls "github.com/aliyun/alibabacloud-nls-go-sdk"
	"github.com/google/uuid"
)

// TranscriptionSession 是一次实时长语音转写会话。
// 通过 NLS.NewTranscriptionSession 创建,返回时 NLS 已就绪;
// 调用方按需 SendAudio,并在结束时调用 Stop,通过 Events 通道消费事件。
//
// 事件通道 eventCh **永不关闭**。消费方根据 EventDone / EventError 终止事件
// 或 context.Done 退出循环;终止后 emit 自动变成 no-op,避免 send-on-closed 风险。
type TranscriptionSession struct {
	st        *nls.SpeechTranscription
	logger    *nls.NlsLogger
	sessionID string

	eventCh chan TranscriptionEvent

	// terminated 一旦为 true:
	//   - emit 立即返回(no-op),防止终止后还有事件挤入
	//   - Stop 跳过 st.Stop()/waitReady,直接 Shutdown,避免 NLS 已 failed 时再等 20s
	terminated atomic.Bool
	stopOnce   sync.Once
}

// Events 返回事件只读通道,通道**永不关闭**;消费侧请基于 EventDone / EventError 或 ctx 退出。
func (s *TranscriptionSession) Events() <-chan TranscriptionEvent {
	return s.eventCh
}

// SessionID 返回内部 session id,便于日志关联。
func (s *TranscriptionSession) SessionID() string {
	return s.sessionID
}

// SendAudio 向 NLS 透传一帧音频数据。
func (s *TranscriptionSession) SendAudio(data []byte) error {
	if s.st == nil {
		return errors.New("nls transcription not initialized")
	}
	return s.st.SendAudioData(data)
}

// Stop 结束 session。幂等,可被并发调用多次。
//   - 若 NLS 已通过回调标记为 terminated(TaskFailed/Completed/Close),仅做 Shutdown
//   - 否则发 StopTranscription 等待 Completed,再 Shutdown
func (s *TranscriptionSession) Stop() error {
	var err error
	s.stopOnce.Do(func() {
		if s.terminated.Load() {
			s.st.Shutdown()
			return
		}
		ready, e := s.st.Stop()
		if e != nil {
			err = e
			s.st.Shutdown()
			s.terminated.Store(true)
			return
		}
		if e := waitReady(ready, s.logger); e != nil {
			err = e
		}
		s.st.Shutdown()
		s.terminated.Store(true)
	})
	return err
}

// emit 将事件写入通道。terminated 后 no-op;buffer 满则丢弃并打日志。
// 单次发送非阻塞 → 不会与 SDK 回调串行点死锁。
func (s *TranscriptionSession) emit(ev TranscriptionEvent) {
	if s.terminated.Load() {
		return
	}
	select {
	case s.eventCh <- ev:
	default:
		s.logger.Println("event channel full, dropping:", ev.Type)
	}
}

// markTerminated 把会话标记为已终止(回调里使用,通常在 emit 终止事件之后调用)。
func (s *TranscriptionSession) markTerminated() {
	s.terminated.Store(true)
}

// isTerminated 仅供回调判断。
func (s *TranscriptionSession) isTerminated() bool {
	return s.terminated.Load()
}

// NewTranscriptionSession 创建并启动一个实时长语音转写会话。
// 阻塞至 NLS 回复 TranscriptionStarted (或失败/超时)。
func (n *NLS) NewTranscriptionSession(ctx context.Context, userID uuid.UUID, p TranscriptionParam) (*TranscriptionSession, error) {
	sessionID := uuid.NewString()

	logger := nls.NewNlsLogger(os.Stderr, sessionID, log.LstdFlags|log.Lmicroseconds)
	logger.SetLogSil(false)
	logger.SetDebug(true)
	logger.Printf("new transcription session user=%s", userID.String())

	token, err := n.getToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("get nls token: %w", err)
	}
	cfg := nls.NewConnectionConfigWithToken(nls.DEFAULT_URL, n.cfg.NLS.AppKey, token)

	session := &TranscriptionSession{
		logger:    logger,
		sessionID: sessionID,
		eventCh:   make(chan TranscriptionEvent, 32),
	}

	st, err := nls.NewSpeechTranscription(cfg, logger,
		onTrTaskFailed, onTrStarted,
		onTrSentenceBegin, onTrSentenceEnd, onTrResultChanged,
		onTrCompleted, onTrClose, session)
	if err != nil {
		return nil, fmt.Errorf("create nls transcription: %w", err)
	}
	session.st = st

	param := nls.DefaultSpeechTranscriptionParam()
	if p.Format != "" {
		param.Format = p.Format
	}
	if p.SampleRate != 0 {
		param.SampleRate = p.SampleRate
	}
	// 以下三项按 docs/speech-to-text-stream.md 约定恒定开启
	param.EnableIntermediateResult = true
	param.EnablePunctuationPrediction = true
	param.EnableInverseTextNormalization = true
	param.EnableWords = false

	// SDK 的 SpeechTranscriptionStartParam 不暴露 disfluency,
	// 通过 extra 透传到 NLS payload。
	var extra map[string]any
	if p.Disfluency {
		extra = map[string]any{"disfluency": true}
	}

	ready, err := st.Start(param, extra)
	if err != nil {
		st.Shutdown()
		return nil, fmt.Errorf("nls start: %w", err)
	}
	if err := waitReady(ready, logger); err != nil {
		st.Shutdown()
		return nil, fmt.Errorf("nls start ready: %w", err)
	}

	return session, nil
}
