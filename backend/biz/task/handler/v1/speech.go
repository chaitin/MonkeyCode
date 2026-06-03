package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/GoYoko/web"
	"github.com/coder/websocket"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/nls"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

// SpeechToText 语音转文字
//
//	@Summary		语音转文字
//	@Description	上传音频数据进行语音识别，返回Server-Sent Events流式文字结果。响应格式为SSE，每个事件包含event和data字段。
//	@Tags			【用户】任务管理
//	@Accept			application/octet-stream
//	@Produce		text/event-stream
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	domain.SpeechRecognitionEvent	"Server-Sent Events流，包含recognition(识别结果)、end(结束)和error(错误)事件"
//	@Failure		400	{object}	web.Resp						"参数错误"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/tasks/speech-to-text [post]
func (h *TaskHandler) SpeechToText(c *web.Context) error {
	user := middleware.GetUser(c)

	if h.nls == nil {
		h.logger.ErrorContext(c.Request().Context(), "speech recognition service not initialized")
		return errcode.ErrInternalServer
	}

	audioData, err := io.ReadAll(c.Request().Body)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to read audio data", "error", err)
		return errcode.ErrInternalServer
	}
	if len(audioData) == 0 {
		h.logger.ErrorContext(c.Request().Context(), "no audio data provided")
		return errcode.ErrInvalidParameter
	}

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := c.Response().Writer.(http.Flusher)
	if !ok {
		h.logger.ErrorContext(c.Request().Context(), "streaming not supported")
		http.Error(c.Response().Writer, "Streaming not supported", http.StatusInternalServerError)
		return errcode.ErrInternalServer
	}

	resultCh, errorCh := h.nls.SpeechRecognition(c.Request().Context(), user.ID, audioData)

	timeout := time.After(2 * time.Minute)
	for {
		select {
		case result, ok := <-resultCh:
			if !ok {
				endEvent := domain.SpeechRecognitionEvent{
					Event: "end",
					Data:  domain.SpeechRecognitionData{Type: "end"},
				}
				h.sendSSEEvent(c, flusher, endEvent)
				return nil
			}
			recognitionEvent := domain.SpeechRecognitionEvent{
				Event: "recognition",
				Data: domain.SpeechRecognitionData{
					Type:      "result",
					Text:      result.Text,
					IsFinal:   result.IsFinal,
					UserID:    result.UserID,
					Timestamp: result.Timestamp,
				},
			}
			h.sendSSEEvent(c, flusher, recognitionEvent)

		case err := <-errorCh:
			if err != nil {
				h.logger.ErrorContext(c.Request().Context(), "speech recognition error", "error", err)
				errorEvent := domain.SpeechRecognitionEvent{
					Event: "error",
					Data: domain.SpeechRecognitionData{
						Type:  "error",
						Error: err.Error(),
					},
				}
				h.sendSSEEvent(c, flusher, errorEvent)
				return nil
			}
			return nil

		case <-timeout:
			h.logger.WarnContext(c.Request().Context(), "speech recognition timeout")
			timeoutEvent := domain.SpeechRecognitionEvent{
				Event: "error",
				Data: domain.SpeechRecognitionData{
					Type:  "error",
					Error: "speech recognition timeout",
				},
			}
			h.sendSSEEvent(c, flusher, timeoutEvent)
			return nil

		case <-c.Request().Context().Done():
			h.logger.InfoContext(c.Request().Context(), "client disconnected from speech recognition")
			return nil
		}
	}
}

func (h *TaskHandler) sendSSEEvent(c *web.Context, flusher http.Flusher, event domain.SpeechRecognitionEvent) {
	eventData := domain.SpeechRecognitionData{
		Type: event.Data.Type,
	}

	switch event.Data.Type {
	case "result":
		eventData.Text = event.Data.Text
		eventData.IsFinal = event.Data.IsFinal
		eventData.UserID = event.Data.UserID
		eventData.Timestamp = event.Data.Timestamp
	case "error":
		eventData.Error = event.Data.Error
	case "end":
	}

	jsonData, err := json.Marshal(eventData)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to marshal SSE event data", "error", err, "event", event.Event)
		return
	}

	fmt.Fprintf(c.Response().Writer, "event: %s\ndata: %s\n\n", event.Event, jsonData)
	flusher.Flush()
}

var (
	speechStreamAllowedFormats = map[string]struct{}{
		"":      {},
		"pcm":   {},
		"wav":   {},
		"opus":  {},
		"speex": {},
		"amr":   {},
		"mp3":   {},
		"aac":   {},
	}
	speechStreamAllowedSampleRates = map[int]struct{}{
		0:     {},
		8000:  {},
		16000: {},
	}
)

// SpeechToTextStream 实时语音转写(WebSocket 流式)
//
//	@Summary		实时语音转写(WebSocket 流式)
//	@Description	通过 WebSocket 上传实时音频流并实时返回识别结果。完整协议见 docs/speech-to-text-stream.md。
//	@Description
//	@Description	## 帧类型约定
//	@Description	| 方向 | 帧类型 | 用途 |
//	@Description	|---|---|---|
//	@Description	| C → S | Text(JSON) | 控制消息:start / stop |
//	@Description	| C → S | Binary | 音频字节流,直接透传给阿里云 NLS,服务端不缓冲 |
//	@Description	| S → C | Text(JSON) | 所有事件(ready / sentence_begin / partial / final / done / error) |
//	@Description
//	@Description	## 客户端 → 服务端
//	@Description
//	@Description	### 1) start (第一帧必须是它)
//	@Description	```json
//	@Description	{
//	@Description	  "type": "start",
//	@Description	  "format": "pcm",
//	@Description	  "sample_rate": 16000,
//	@Description	  "disfluency": false
//	@Description	}
//	@Description	```
//	@Description	- `format` 可选,默认 `pcm`。支持 `pcm` / `wav` / `opus` / `speex` / `amr` / `mp3` / `aac`,单声道、16-bit
//	@Description	- `sample_rate` 可选,默认 `16000`。仅支持 `8000` 或 `16000`
//	@Description	- `disfluency` 可选,默认 `false`。`true` 时过滤"嗯""啊"等口头禅
//	@Description	- 服务端校验通过 → 启动 NLS session → 收到 `TranscriptionStarted` 后向客户端下发 `ready` 事件
//	@Description	- **客户端必须在收到 `ready` 之后才能发 Binary 音频帧**
//	@Description	- 以下能力默认开启且不可关闭:中间结果、标点预测、ITN(中文数字转阿拉伯数字)
//	@Description
//	@Description	### 2) Binary 音频帧
//	@Description	`ready` 之后,客户端以任意大小(建议 20–100ms / 帧)持续发 Binary 帧,服务端原样透传 NLS
//	@Description
//	@Description	### 3) stop (主动结束)
//	@Description	```json
//	@Description	{ "type": "stop" }
//	@Description	```
//	@Description	服务端收到后停止 NLS,等待 `TranscriptionCompleted` 后下发 `done` 事件并关闭 WS。客户端直接 close WS 亦可。
//	@Description
//	@Description	## 服务端 → 客户端
//	@Description
//	@Description	所有事件统一外层结构:
//	@Description	```json
//	@Description	{ "type": "<event_type>", "timestamp": 1733299200000, ... }
//	@Description	```
//	@Description
//	@Description	### ready — NLS 已就绪
//	@Description	```json
//	@Description	{ "type": "ready", "timestamp": 1733299200000 }
//	@Description	```
//	@Description	仅推送一次。客户端收到后开始发 Binary 音频帧。
//	@Description
//	@Description	### sentence_begin — 一句话开始
//	@Description	```json
//	@Description	{ "type": "sentence_begin", "index": 1, "timestamp": 1733299201000 }
//	@Description	```
//	@Description	- `index`:句子序号,从 1 开始,session 内单调递增
//	@Description
//	@Description	### partial — 中间结果(实时滚动,会反复推送)
//	@Description	```json
//	@Description	{ "type": "partial", "index": 1, "text": "今天天气真", "timestamp": 1733299201500 }
//	@Description	```
//	@Description	- 同一 `index` 的 `partial` 会反复推送,`text` 通常逐渐变长
//	@Description	- **客户端必须用 `text` 覆盖该句显示内容,不要追加**
//	@Description
//	@Description	### final — 一句话定稿
//	@Description	```json
//	@Description	{ "type": "final", "index": 1, "text": "今天天气真不错。", "timestamp": 1733299202800 }
//	@Description	```
//	@Description	- 该句识别完成、内容固化,后续不会再变;客户端用 `text` 覆盖 `index` 对应位置
//	@Description	- `final` 之后可能立刻收到下一句的 `sentence_begin`
//	@Description
//	@Description	### done — 整个 session 结束
//	@Description	```json
//	@Description	{ "type": "done", "timestamp": 1733299210000 }
//	@Description	```
//	@Description	- 服务端已停止识别、释放资源,即将关闭 WS;`done` 之后不会再有任何事件
//	@Description
//	@Description	### error — 错误(透传阿里云 header)
//	@Description	阿里云 NLS 触发的错误:
//	@Description	```json
//	@Description	{
//	@Description	  "type": "error",
//	@Description	  "header": {
//	@Description	    "namespace": "SpeechTranscriber",
//	@Description	    "name": "TaskFailed",
//	@Description	    "status": 40000001,
//	@Description	    "status_text": "Gateway:TOKEN_INVALID:Token is invalid.",
//	@Description	    "task_id": "5ec521b5aa104e3abccf3d361822****",
//	@Description	    "message_id": "c3a9ae4b231649d5ae05d4af36fd****"
//	@Description	  },
//	@Description	  "timestamp": 1733299205000
//	@Description	}
//	@Description	```
//	@Description	本服务前置校验错误(NLS 未建立时):`status=0`,在 `status_text` 描述原因:
//	@Description	```json
//	@Description	{
//	@Description	  "type": "error",
//	@Description	  "header": { "status": 0, "status_text": "first message must be a 'start' control message" },
//	@Description	  "timestamp": 1733299205000
//	@Description	}
//	@Description	```
//	@Description
//	@Description	## 阿里云常见错误码速查
//	@Description	| status | 含义 | 典型原因 |
//	@Description	|---|---|---|
//	@Description	| `40000001` | Token 过期/失效 | 重连即可,后端会自动刷新 token |
//	@Description	| `40000004` | 空闲超时(10s 没发音频) | 提示用户继续说话或主动关闭 |
//	@Description	| `40000005` | 并发超限 | 退避重试,联系运维扩容 |
//	@Description	| `40000010` | 试用过期/欠费 | 联系运维 |
//	@Description	| `40270002` | 无有效语音 | 检查麦克风/录音环境 |
//	@Description	| `40270003` | 音频解码失败 | `format` 参数与实际音频不匹配 |
//	@Description	| `41010101` | 不支持的采样率 | `sample_rate` 必须是 8000 或 16000 |
//	@Description	| `41040201` | 数据未连续发送 | 前端帧节奏过慢 |
//	@Description	| `5xxxxxxx` | 服务端瞬时错误 | 直接重试 |
//	@Description	完整列表见 https://help.aliyun.com/zh/isi/developer-reference/api-reference
//	@Description
//	@Description	## 时序示例
//	@Description	```
//	@Description	C → S: WS upgrade (带鉴权)
//	@Description	C → S: {"type":"start","sample_rate":16000}
//	@Description	S → C: {"type":"ready"}
//	@Description	C → S: <binary> <binary>
//	@Description	S → C: {"type":"sentence_begin","index":1}
//	@Description	S → C: {"type":"partial","index":1,"text":"今天"}
//	@Description	S → C: {"type":"partial","index":1,"text":"今天天气真"}
//	@Description	S → C: {"type":"final","index":1,"text":"今天天气真不错。"}
//	@Description	C → S: {"type":"stop"}
//	@Description	S → C: {"type":"done"}
//	@Description	WS close
//	@Description	```
//	@Description
//	@Description	## 与 POST /speech-to-text 的差异
//	@Description	- 旧 POST 接口:整段录音 → SSE 单段结果,适合短语音 ≤60s(PC 客户端)
//	@Description	- 本接口:WS 双向实时流,支持长语音、句级 final、可被打断,适合 Web/移动端边说边显示
//	@Description
//	@Tags			【用户】任务管理
//	@Security		MonkeyCodeAIAuth
//	@Success		101	{object}	domain.SpeechStreamEvent	"WebSocket 升级成功;此后通过 WS 帧通信,事件结构见上方说明"
//	@Failure		401	{object}	web.Resp					"未授权"
//	@Failure		500	{object}	web.Resp					"服务器内部错误(NLS 服务未配置等)"
//	@Router			/api/v1/users/tasks/speech-to-text-stream [get]
func (h *TaskHandler) SpeechToTextStream(c *web.Context) error {
	logger := h.logger.With("fn", "task.speech_to_text_stream")

	if h.nls == nil {
		logger.ErrorContext(c.Request().Context(), "nls service not initialized")
		return errcode.ErrInternalServer
	}

	user := middleware.GetUser(c)

	wsConn, err := ws.Accept(c.Response().Writer, c.Request())
	if err != nil {
		logger.ErrorContext(c.Request().Context(), "failed to upgrade to websocket", "error", err)
		return err
	}
	defer wsConn.Close()

	ctx, cancel := context.WithCancelCause(c.Request().Context())
	defer cancel(fmt.Errorf("stream close"))

	// 1. 等待客户端首帧:必须是 {"type":"start"}
	startReq, err := h.readSpeechStartFrame(ctx, wsConn)
	if err != nil {
		h.writeSpeechError(wsConn, 0, err.Error())
		return nil
	}

	// 2. 启动 NLS session(阻塞至 ready 或失败)
	session, err := h.nls.NewTranscriptionSession(ctx, user.ID, nls.TranscriptionParam{
		Format:     startReq.Format,
		SampleRate: startReq.SampleRate,
		Disfluency: startReq.Disfluency,
	})
	if err != nil {
		logger.ErrorContext(ctx, "failed to start nls transcription", "error", err)
		h.writeSpeechError(wsConn, 0, "nls start failed: "+err.Error())
		return nil
	}
	logger = logger.With("session_id", session.SessionID())
	defer func() {
		if stopErr := session.Stop(); stopErr != nil {
			logger.WarnContext(ctx, "stop session failed", "error", stopErr)
		}
	}()

	// 3. 通知客户端 ready
	if err := h.writeSpeechEvent(wsConn, domain.SpeechStreamEvent{
		Type:      string(nls.EventReady),
		Timestamp: time.Now().UnixMilli(),
	}); err != nil {
		logger.WarnContext(ctx, "write ready failed", "error", err)
		return nil
	}

	// 4. goroutine:NLS 事件 → WS
	// session.Events() 通道永不关闭,这里靠 EventDone / EventError 或 ctx.Done 退出。
	go func() {
		defer cancel(fmt.Errorf("event pump exit"))
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-session.Events():
				if err := h.writeSpeechEvent(wsConn, toSpeechStreamEvent(ev)); err != nil {
					logger.WarnContext(ctx, "write ws event failed", "error", err, "type", ev.Type)
					return
				}
				if ev.Type == nls.EventDone || ev.Type == nls.EventError {
					return
				}
			}
		}
	}()

	// 5. 主循环:WS → NLS
	for {
		msgType, data, err := wsConn.Conn().Read(ctx)
		if err != nil {
			// 客户端断开或 ctx 取消都走这里;defer 里 session.Stop 会清理
			return nil
		}

		switch msgType {
		case websocket.MessageBinary:
			if err := session.SendAudio(data); err != nil {
				logger.WarnContext(ctx, "send audio failed", "error", err)
				h.writeSpeechError(wsConn, 0, "send audio failed: "+err.Error())
				return nil
			}

		case websocket.MessageText:
			var ctrl domain.SpeechStreamControl
			if err := json.Unmarshal(data, &ctrl); err != nil {
				h.writeSpeechError(wsConn, 0, "invalid control message: "+err.Error())
				return nil
			}
			switch ctrl.Type {
			case "stop":
				// session.Stop 由 defer 兜底;此处直接返回,等事件 goroutine 把 done 推给客户端
				return nil
			case "start":
				h.writeSpeechError(wsConn, 0, "duplicate start message")
				return nil
			default:
				h.writeSpeechError(wsConn, 0, "unknown control type: "+ctrl.Type)
				return nil
			}
		}
	}
}

func (h *TaskHandler) readSpeechStartFrame(ctx context.Context, wsConn *ws.WebsocketManager) (*domain.SpeechStreamStartReq, error) {
	msgType, data, err := wsConn.Conn().Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read first frame: %w", err)
	}
	if msgType != websocket.MessageText {
		return nil, fmt.Errorf("first message must be a 'start' control message")
	}
	var req domain.SpeechStreamStartReq
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid start payload: %w", err)
	}
	if req.Type != "start" {
		return nil, fmt.Errorf("first message must be a 'start' control message")
	}
	if _, ok := speechStreamAllowedFormats[req.Format]; !ok {
		return nil, fmt.Errorf("unsupported format: %s", req.Format)
	}
	if _, ok := speechStreamAllowedSampleRates[req.SampleRate]; !ok {
		return nil, fmt.Errorf("unsupported sample_rate: %d", req.SampleRate)
	}
	return &req, nil
}

func (h *TaskHandler) writeSpeechEvent(wsConn *ws.WebsocketManager, ev domain.SpeechStreamEvent) error {
	if ev.Timestamp == 0 {
		ev.Timestamp = time.Now().UnixMilli()
	}
	return wsConn.WriteJSON(ev)
}

func (h *TaskHandler) writeSpeechError(wsConn *ws.WebsocketManager, status int, statusText string) {
	_ = h.writeSpeechEvent(wsConn, domain.SpeechStreamEvent{
		Type: string(nls.EventError),
		Header: &domain.SpeechStreamErrorHeader{
			Status:     status,
			StatusText: statusText,
		},
		Timestamp: time.Now().UnixMilli(),
	})
}

func toSpeechStreamEvent(ev nls.TranscriptionEvent) domain.SpeechStreamEvent {
	out := domain.SpeechStreamEvent{
		Type:      string(ev.Type),
		Index:     ev.Index,
		Text:      ev.Text,
		Timestamp: ev.Timestamp,
	}
	if ev.Header != nil {
		out.Header = &domain.SpeechStreamErrorHeader{
			Namespace:  ev.Header.Namespace,
			Name:       ev.Header.Name,
			Status:     ev.Header.Status,
			StatusText: ev.Header.StatusText,
			TaskID:     ev.Header.TaskID,
			MessageID:  ev.Header.MessageID,
		}
	}
	return out
}
