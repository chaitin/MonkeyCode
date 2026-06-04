package doubao

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/chaitin/MonkeyCode/backend/pkg/asr"
)

// session 实现 asr.Session,一次豆包流式语音识别会话。
//
// 事件通道 eventCh **永不关闭** (与 NLS 那版语义一致),消费侧基于
// EventDone/EventError 或 ctx 退出。
type session struct {
	conn      *websocket.Conn
	logger    *slog.Logger
	sessionID string
	requestID string
	logid     string

	eventCh chan asr.Event

	// audioSeq 下一帧音频的 sequence,从 2 开始 (1 已被 Full Client Request 占用)
	audioSeq atomic.Int32

	// definiteCount 已 emit final 的 utterance 数量,用于 diff 推 partial/final
	definiteCount int
	mu            sync.Mutex // 保护 definiteCount + sendAudio 写 conn 的串行

	terminated atomic.Bool
	stopOnce   sync.Once

	cancelRecv context.CancelFunc
}

func newSession(conn *websocket.Conn, logger *slog.Logger, sessionID, requestID, logid string) *session {
	s := &session{
		conn:      conn,
		logger:    logger,
		sessionID: sessionID,
		requestID: requestID,
		logid:     logid,
		eventCh:   make(chan asr.Event, 32),
	}
	s.audioSeq.Store(2) // sequence 1 已被 Full Client Request 占用
	return s
}

func (s *session) SessionID() string        { return s.sessionID }
func (s *session) Logid() string            { return s.logid }
func (s *session) Events() <-chan asr.Event { return s.eventCh }

// SendAudio 把一帧音频推给豆包。seq 由内部自增维护,无需调用方关心。
// 多 goroutine 调用会被串行化 (websocket 写要互斥)。
func (s *session) SendAudio(data []byte) error {
	if s.terminated.Load() {
		return errors.New("session terminated")
	}
	seq := s.audioSeq.Add(1) - 1
	frame := encodeAudioRequest(seq, data)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.WriteMessage(websocket.BinaryMessage, frame)
}

// Stop 优雅结束 session:发送"最后一包" (负 sequence + 空音频),
// 触发服务端下发 last 响应,recvLoop 自然推 EventDone 并退出。
// 幂等,可并发调用多次。
func (s *session) Stop() error {
	var err error
	s.stopOnce.Do(func() {
		if s.terminated.Load() {
			s.shutdown()
			return
		}
		// 最后一包 seq = "下一个要发的 seq" 取负。
		// audioSeq 始终保存的是下一帧的 seq (Add(1) 后才用,所以 Load() 拿到的就是 next),
		// 直接取负即可。例:已发 N 帧 (seq=2..N+1) → audioSeq=N+2 → lastSeq=-(N+2)。
		// 一帧音频都没发过时 audioSeq 仍是初始的 2 → lastSeq=-2,合法。
		//
		// 之前用 -(audioSeq-1) 会比豆包 autoAssignedSequence 小 1,触发
		// "autoAssignedSequence (-X) mismatch sequence in request (-X+1)" 错误。
		lastSeq := -s.audioSeq.Load()
		frame := encodeAudioRequest(lastSeq, nil)
		s.mu.Lock()
		writeErr := s.conn.WriteMessage(websocket.BinaryMessage, frame)
		s.mu.Unlock()
		if writeErr != nil {
			err = fmt.Errorf("send last frame: %w", writeErr)
			s.shutdown()
			return
		}
		// 等 recvLoop 在收到 last 响应后自己退出并 emit done。
		// 这里不主动关 conn,避免 race。recv 超时由上层 ctx 控制。
	})
	return err
}

// shutdown 真正关连接 + 标记 terminated。
func (s *session) shutdown() {
	s.terminated.Store(true)
	if s.cancelRecv != nil {
		s.cancelRecv()
	}
	_ = s.conn.Close()
}

// emit 非阻塞推事件;通道满时丢弃 (并打日志,避免阻塞 recv goroutine)。
func (s *session) emit(ev asr.Event) {
	if s.terminated.Load() && ev.Type != asr.EventError && ev.Type != asr.EventDone {
		return
	}
	if ev.Timestamp == 0 {
		ev.Timestamp = time.Now().UnixMilli()
	}
	select {
	case s.eventCh <- ev:
	default:
		s.logger.Warn("doubao event channel full, drop", "type", ev.Type, "session", s.sessionID)
	}
}

// recvLoop 持续从豆包 WS 读 frame,转换为 asr.Event 推给上层。
// ctx 取消或读 frame 出错时退出。退出前若未 emit 过 done/error,补 EventError。
func (s *session) recvLoop(ctx context.Context) {
	defer s.shutdown()

	for {
		select {
		case <-ctx.Done():
			s.emitAbnormalClose(ctx.Err())
			return
		default:
		}

		_, msg, err := s.conn.ReadMessage()
		if err != nil {
			s.emitAbnormalClose(err)
			return
		}
		f, err := parseFrame(msg)
		if err != nil {
			s.logger.Warn("doubao parse frame", "error", err)
			continue
		}

		switch f.messageType {
		case msgTypeFullServerResp:
			s.handleResultFrame(f)
			if f.isLastPkg {
				s.emit(asr.Event{Type: asr.EventDone, Logid: s.logid})
				return
			}
		case msgTypeServerError:
			s.emit(asr.Event{
				Type:  asr.EventError,
				Logid: s.logid,
				Error: &asr.Error{
					Code:      int(f.errorCode),
					Message:   extractErrorMessage(f.payload),
					RequestID: s.requestID,
					Logid:     s.logid,
				},
			})
			return
		default:
			s.logger.Debug("doubao unknown frame", "type", f.messageType)
		}
	}
}

// handleResultFrame 解析 server full response,diff utterances 推 partial/final。
//
// 豆包响应里 result.utterances 是**累计已分句列表**:
//   - 列表里 definite=true 的句子已固化、不会变;definite=false 的是当前正在识别的句子
//   - 与上一帧相比,新出现 definite=true 的句子 → emit final
//   - 列表末尾若有 definite=false 的句子 → emit partial (会反复推送)
func (s *session) handleResultFrame(f *parsedFrame) {
	if len(f.payload) == 0 {
		return
	}
	var resp serverRespPayload
	if err := json.Unmarshal(f.payload, &resp); err != nil {
		s.logger.Warn("doubao unmarshal result", "error", err)
		return
	}

	s.mu.Lock()
	prevDefinite := s.definiteCount
	s.mu.Unlock()

	utts := resp.Result.Utterances
	newDefinite := 0
	for _, u := range utts {
		if u.Definite {
			newDefinite++
		}
	}

	// 1) 新 definite 的句子 → final (按出现顺序逐个 emit,index 从 1 开始)
	for i := prevDefinite; i < newDefinite; i++ {
		s.emit(asr.Event{
			Type:  asr.EventFinal,
			Index: i + 1,
			Text:  utts[i].Text,
		})
	}

	// 2) 末尾若有非 definite 的 utterance → partial
	if len(utts) > newDefinite {
		// 末尾活跃句子的下标 = len-1, index = len
		last := utts[len(utts)-1]
		s.emit(asr.Event{
			Type:  asr.EventPartial,
			Index: len(utts),
			Text:  last.Text,
		})
	}

	s.mu.Lock()
	s.definiteCount = newDefinite
	s.mu.Unlock()
}

// emitAbnormalClose 在 recv 异常退出时补一个 error 事件 (若尚未 emit 过)。
// 客户端主动 close / 远端正常 close 在 done 之后才会触发,此时已 terminated → 跳过。
func (s *session) emitAbnormalClose(err error) {
	if s.terminated.Load() {
		return
	}
	if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
		s.emit(asr.Event{Type: asr.EventDone, Logid: s.logid})
		return
	}
	s.emit(asr.Event{
		Type:  asr.EventError,
		Logid: s.logid,
		Error: &asr.Error{
			Code:      0,
			Message:   "doubao connection lost: " + err.Error(),
			RequestID: s.requestID,
			Logid:     s.logid,
		},
	})
}

// 编译期断言: *session 实现 asr.Session
var _ asr.Session = (*session)(nil)

// 编译期断言: uuid.UUID 用于 NewSession 签名 (避免 unused import)
var _ = uuid.UUID{}
