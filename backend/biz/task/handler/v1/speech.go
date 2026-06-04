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
	"github.com/chaitin/MonkeyCode/backend/pkg/asr"
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

// speechStreamAllowedFormats 豆包 SAUC bigmodel 支持的音频容器格式白名单。
// "" 表示客户端未传,后端默认按 pcm 处理。
var speechStreamAllowedFormats = map[string]struct{}{
	"":    {},
	"pcm": {},
	"wav": {},
	"ogg": {},
	"mp3": {},
}

// SpeechToTextStream 实时语音转写(WebSocket 流式)
//
//	@Summary		实时语音转写(WebSocket 流式)
//	@Description	通过 WebSocket 上传实时音频流并实时返回识别结果。
//	@Description	后端使用豆包流式语音识别 2.0 (bigmodel_async)。完整协议见 docs/speech-to-text-stream.md。
//	@Description
//	@Description	## 帧类型约定
//	@Description	| 方向 | 帧类型 | 用途 |
//	@Description	|---|---|---|
//	@Description	| C → S | Text(JSON) | 控制消息:start / stop |
//	@Description	| C → S | Binary | 音频字节流,服务端封装为豆包帧透传 |
//	@Description	| S → C | Text(JSON) | 所有事件(ready / partial / final / done / error) |
//	@Description
//	@Description	## 客户端 → 服务端
//	@Description
//	@Description	### 1) start (第一帧必须是它)
//	@Description	```json
//	@Description	{
//	@Description	  "type": "start",
//	@Description	  "format": "pcm",
//	@Description	  "disfluency": false
//	@Description	}
//	@Description	```
//	@Description	- `format` 可选,默认 `pcm`。支持 `pcm` / `wav` / `ogg` / `mp3`,单声道、16-bit、采样率固定 16000Hz
//	@Description	  - `pcm` / `wav` 内部音频流必须是 `pcm_s16le`;`ogg` 必须为 `opus` 编码;`mp3` 由远端解码
//	@Description	- `disfluency` 可选,默认 `false`。`true` 时启用语义顺滑(过滤"嗯/啊"等口头禅、语义重复词)
//	@Description	- 服务端校验通过 → 与豆包建立 WSS → 收到首个响应后向客户端下发 `ready` 事件(带 `logid`)
//	@Description	- **客户端必须在收到 `ready` 之后才能发 Binary 音频帧**
//	@Description	- 以下能力默认开启:中间结果(双向流式天然有)、标点预测、ITN(中文数字转阿拉伯数字)
//	@Description
//	@Description	### 2) Binary 音频帧
//	@Description	`ready` 之后,客户端持续发 Binary 帧。**建议每帧 200ms**(豆包推荐值,过碎会影响性能)。
//	@Description
//	@Description	### 3) stop (主动结束)
//	@Description	```json
//	@Description	{ "type": "stop" }
//	@Description	```
//	@Description	服务端收到后向豆包发送"最后一包"标志,等待豆包最终响应后下发 `done` 事件并关闭 WS。客户端直接 close WS 亦可。
//	@Description
//	@Description	## 服务端 → 客户端
//	@Description
//	@Description	所有事件统一外层结构:
//	@Description	```json
//	@Description	{ "type": "<event_type>", "timestamp": 1733299200000, ... }
//	@Description	```
//	@Description
//	@Description	### ready — 远端已就绪
//	@Description	```json
//	@Description	{ "type": "ready", "logid": "202407261553070FACFE6D19421815D605", "timestamp": 1733299200000 }
//	@Description	```
//	@Description	仅推送一次。客户端收到后开始发 Binary 音频帧。`logid` 是豆包返回的 `X-Tt-Logid`,排障必备,
//	@Description	建议前端在 session 期间一直打印它,跟后续 error 事件可以关联。
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
//	@Description	- `final` 之后可能立刻有下一句的 `partial`(`index+1`)
//	@Description
//	@Description	### done — 整个 session 结束
//	@Description	```json
//	@Description	{ "type": "done", "logid": "...", "timestamp": 1733299210000 }
//	@Description	```
//	@Description	- 服务端已收到豆包最后一包响应、释放资源,即将关闭 WS;`done` 之后不会再有任何事件
//	@Description
//	@Description	### error — 错误
//	@Description	豆包远端错误:
//	@Description	```json
//	@Description	{
//	@Description	  "type": "error",
//	@Description	  "logid": "202407261553070FACFE6D19421815D605",
//	@Description	  "error": {
//	@Description	    "code": 45000001,
//	@Description	    "message": "请求参数无效",
//	@Description	    "request_id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3",
//	@Description	    "logid": "202407261553070FACFE6D19421815D605"
//	@Description	  },
//	@Description	  "timestamp": 1733299205000
//	@Description	}
//	@Description	```
//	@Description	本服务前置校验错误(远端连接前):`code=0`,在 `message` 描述原因:
//	@Description	```json
//	@Description	{
//	@Description	  "type": "error",
//	@Description	  "error": { "code": 0, "message": "first message must be a 'start' control message" },
//	@Description	  "timestamp": 1733299205000
//	@Description	}
//	@Description	```
//	@Description
//	@Description	## 豆包常见错误码速查
//	@Description	| code | 含义 | 典型原因 |
//	@Description	|---|---|---|
//	@Description	| `45000001` | 请求参数无效 | 缺字段 / 字段值无效 / 重复请求 |
//	@Description	| `45000002` | 空音频 | 录音未采集到声音 |
//	@Description	| `45000081` | 等包超时 | 前端没在期限内连续发送音频帧 |
//	@Description	| `45000151` | 音频格式不正确 | `format` 与实际音频不匹配 |
//	@Description	| `55000031` | 服务器繁忙 | 退避重试 |
//	@Description	| `550xxxxx` | 服务内部错误 | 直接重试,持续失败时带 `logid` 联系运维 |
//	@Description
//	@Description	## 时序示例
//	@Description	```
//	@Description	C → S: WS upgrade (带鉴权)
//	@Description	C → S: {"type":"start","format":"pcm"}
//	@Description	S → C: {"type":"ready","logid":"..."}
//	@Description	C → S: <binary 200ms> <binary 200ms> ...
//	@Description	S → C: {"type":"partial","index":1,"text":"今天"}
//	@Description	S → C: {"type":"partial","index":1,"text":"今天天气真"}
//	@Description	S → C: {"type":"final","index":1,"text":"今天天气真不错。"}
//	@Description	C → S: {"type":"stop"}
//	@Description	S → C: {"type":"done","logid":"..."}
//	@Description	WS close
//	@Description	```
//	@Description
//	@Description	## 与 POST /speech-to-text 的差异
//	@Description	- POST /speech-to-text:整段录音 → SSE 单段结果,适合短语音 ≤60s
//	@Description	- 本接口:WS 双向实时流,支持长语音、句级 final、可被打断,适合 Web/移动端边说边显示
//	@Description
//	@Tags			【用户】任务管理
//	@Security		MonkeyCodeAIAuth
//	@Param			start	body		domain.SpeechStreamStartReq	false	"[WS 协议] 客户端连接后首帧 JSON Text 控制消息 schema;不是 HTTP body,仅供前端代码生成 TS 类型,实际通过 WS Text 帧发送"
//	@Success		101		{object}	domain.SpeechStreamEvent	"WebSocket 升级成功;此后通过 WS 帧通信,事件结构见上方说明"
//	@Failure		401		{object}	web.Resp					"未授权"
//	@Failure		500		{object}	web.Resp					"服务器内部错误(ASR 服务未配置等)"
//	@Router			/api/v1/users/tasks/speech-to-text-stream [get]
func (h *TaskHandler) SpeechToTextStream(c *web.Context) error {
	logger := h.logger.With("fn", "task.speech_to_text_stream")

	if h.asr == nil {
		logger.ErrorContext(c.Request().Context(), "asr service not initialized")
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
		h.writeSpeechError(wsConn, 0, err.Error(), "", "")
		return nil
	}

	// 2. 启动 ASR session(阻塞至 ready 或失败)
	session, err := h.asr.NewSession(ctx, user.ID, asr.Param{
		Format:     startReq.Format,
		Disfluency: startReq.Disfluency,
	})
	if err != nil {
		logger.ErrorContext(ctx, "failed to start asr session", "error", err)
		h.writeSpeechError(wsConn, 0, "asr start failed: "+err.Error(), "", "")
		return nil
	}
	logger = logger.With("session_id", session.SessionID(), "logid", session.Logid())
	defer func() {
		if stopErr := session.Stop(); stopErr != nil {
			logger.WarnContext(ctx, "stop session failed", "error", stopErr)
		}
	}()

	// 3. goroutine:ASR 事件 → WS
	// session.Events() 通道永不关闭,这里靠 EventDone / EventError 或 ctx.Done 退出。
	// ready 事件由 session 在 NewSession 内立刻 emit,这里统一从 Events() 拿出后下发。
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
				if ev.Type == asr.EventDone || ev.Type == asr.EventError {
					return
				}
			}
		}
	}()

	// 4. 主循环:WS → ASR
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
				h.writeSpeechError(wsConn, 0, "send audio failed: "+err.Error(), "", session.Logid())
				return nil
			}

		case websocket.MessageText:
			var ctrl domain.SpeechStreamControl
			if err := json.Unmarshal(data, &ctrl); err != nil {
				h.writeSpeechError(wsConn, 0, "invalid control message: "+err.Error(), "", session.Logid())
				return nil
			}
			switch ctrl.Type {
			case "stop":
				// 主动发送最后一包给豆包(session.Stop 非阻塞,只 write 一帧就返回)。
				// **不能在此 return** —— 否则 defer 立刻 wsConn.Close(),
				// 之后 recvLoop 收到豆包 last 响应再 emit done 时,WS 已关,客户端永远收不到 done。
				// 改为 continue 回到 Read,等 event pump 把 done 写出去后 cancel ctx,
				// Read 才会返回 err,我们再退出 → defer 关 WS。
				if err := session.Stop(); err != nil {
					logger.WarnContext(ctx, "session stop failed", "error", err)
					return nil
				}
				continue
			case "start":
				h.writeSpeechError(wsConn, 0, "duplicate start message", "", session.Logid())
				return nil
			default:
				h.writeSpeechError(wsConn, 0, "unknown control type: "+ctrl.Type, "", session.Logid())
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
	return &req, nil
}

func (h *TaskHandler) writeSpeechEvent(wsConn *ws.WebsocketManager, ev domain.SpeechStreamEvent) error {
	if ev.Timestamp == 0 {
		ev.Timestamp = time.Now().UnixMilli()
	}
	return wsConn.WriteJSON(ev)
}

// writeSpeechError 给客户端下发一个 error 事件。code=0 表示本服务前置校验错误。
// requestID / logid 在远端会话已建立时填入,前置错误时可传空字符串。
func (h *TaskHandler) writeSpeechError(wsConn *ws.WebsocketManager, code int, message, requestID, logid string) {
	_ = h.writeSpeechEvent(wsConn, domain.SpeechStreamEvent{
		Type:  string(asr.EventError),
		Logid: logid,
		Error: &domain.SpeechStreamError{
			Code:      code,
			Message:   message,
			RequestID: requestID,
			Logid:     logid,
		},
		Timestamp: time.Now().UnixMilli(),
	})
}

func toSpeechStreamEvent(ev asr.Event) domain.SpeechStreamEvent {
	out := domain.SpeechStreamEvent{
		Type:      string(ev.Type),
		Index:     ev.Index,
		Text:      ev.Text,
		Logid:     ev.Logid,
		Timestamp: ev.Timestamp,
	}
	if ev.Error != nil {
		out.Error = &domain.SpeechStreamError{
			Code:      ev.Error.Code,
			Message:   ev.Error.Message,
			RequestID: ev.Error.RequestID,
			Logid:     ev.Error.Logid,
		}
	}
	return out
}
