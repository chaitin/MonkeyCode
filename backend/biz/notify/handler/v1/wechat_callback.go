package v1

import (
	"context"
	"encoding/xml"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/notify/usecase"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/msgpush"
)

// 微信回调的默认回复文案。usecase 返回非空文本时优先用 usecase 的；为空时回退到这里。
const (
	defaultReplySubscribe = "感谢关注！您将收到任务进度通知。"
	defaultReplyScan      = "扫码成功"
	defaultReplyClick     = "收到点击事件"
	defaultReplyText      = "收到您的消息"
)

// WechatCallbackHandler 微信公众号回调处理器
type WechatCallbackHandler struct {
	logger       *slog.Logger
	wechatClient *msgpush.WechatClient
	usecase      domain.WechatMPUsecase
}

// NewWechatCallbackHandler 创建微信公众号回调处理器
func NewWechatCallbackHandler(i *do.Injector) (*WechatCallbackHandler, error) {
	w := do.MustInvoke[*web.Web](i)

	h := &WechatCallbackHandler{
		logger:       do.MustInvoke[*slog.Logger](i).With("module", "wechat_mp.callback"),
		wechatClient: do.MustInvoke[*msgpush.WechatClient](i),
		usecase:      do.MustInvoke[domain.WechatMPUsecase](i),
	}

	// 微信回调路由（无需鉴权）
	w.GET("/api/v1/wechat/callback", web.BaseHandler(h.Callback))
	w.POST("/api/v1/wechat/callback", web.BaseHandler(h.Callback))

	return h, nil
}

func (h *WechatCallbackHandler) Callback(c *web.Context) error {
	r := c.Request()
	w := c.Response()
	ctx := r.Context()
	query := r.URL.Query()
	encrypted := h.wechatClient.IsEncryptedMode(query.Get("encrypt_type"))

	switch r.Method {
	case http.MethodGet:
		h.handleVerify(ctx, w, query, encrypted)
	case http.MethodPost:
		h.handleEvent(ctx, w, r, query, encrypted)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
	return nil
}

// handleVerify 处理 GET 校验请求：明文模式验签后回 echostr，加密模式解密 echostr 后回明文。
func (h *WechatCallbackHandler) handleVerify(ctx context.Context, w http.ResponseWriter, query map[string][]string, encrypted bool) {
	timestamp := getQuery(query, "timestamp")
	nonce := getQuery(query, "nonce")
	echostr := getQuery(query, "echostr")

	if encrypted {
		plain, err := h.wechatClient.DecryptEchoStr(getQuery(query, "msg_signature"), timestamp, nonce, echostr)
		if err != nil {
			h.logger.WarnContext(ctx, "wechat mp callback: encrypted echostr verification failed", "error", err)
			writeText(w, http.StatusForbidden, "invalid signature")
			return
		}
		writeText(w, http.StatusOK, plain)
		return
	}

	signature := getQuery(query, "signature")
	if !h.wechatClient.VerifySignature(signature, timestamp, nonce) {
		h.logger.WarnContext(ctx, "wechat mp callback: signature verification failed",
			"signature", signature, "timestamp", timestamp, "nonce", nonce)
		writeText(w, http.StatusForbidden, "invalid signature")
		return
	}
	writeText(w, http.StatusOK, echostr)
}

// handleEvent 处理 POST 事件推送：读 body → (可选)解密 → 解 XML → 路由 → (可选)加密回复 → 写响应。
func (h *WechatCallbackHandler) handleEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, query map[string][]string, encrypted bool) {
	timestamp := getQuery(query, "timestamp")
	nonce := getQuery(query, "nonce")

	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.ErrorContext(ctx, "wechat mp callback: read body failed", "error", err)
		writeText(w, http.StatusBadRequest, "invalid request")
		return
	}

	var msgBody []byte
	if encrypted {
		msgBody, err = h.wechatClient.DecryptMessage(getQuery(query, "msg_signature"), timestamp, nonce, body)
		if err != nil {
			h.logger.ErrorContext(ctx, "wechat mp callback: decrypt message failed", "error", err)
			writeText(w, http.StatusForbidden, "decrypt failed")
			return
		}
	} else {
		signature := getQuery(query, "signature")
		if !h.wechatClient.VerifySignature(signature, timestamp, nonce) {
			h.logger.WarnContext(ctx, "wechat mp callback: POST signature verification failed",
				"signature", signature, "timestamp", timestamp, "nonce", nonce)
			writeText(w, http.StatusForbidden, "invalid signature")
			return
		}
		msgBody = body
	}

	var msg msgpush.Message
	if err := xml.Unmarshal(msgBody, &msg); err != nil {
		h.logger.ErrorContext(ctx, "wechat mp callback: parse message failed", "error", err)
		writeText(w, http.StatusBadRequest, "invalid message")
		return
	}

	reply := h.routeEvent(ctx, &msg)

	if encrypted && string(reply) != "success" {
		enc, err := h.wechatClient.EncryptMessage(reply, timestamp, nonce)
		if err != nil {
			h.logger.ErrorContext(ctx, "wechat mp callback: encrypt reply failed", "error", err)
			writeText(w, http.StatusInternalServerError, "encrypt failed")
			return
		}
		reply = enc
	}

	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(reply)
}

// routeEvent 按 MsgType / Event 路由到对应 usecase，并返回 XML 回复（或 "success" 哨兵字符串）。
func (h *WechatCallbackHandler) routeEvent(ctx context.Context, msg *msgpush.Message) []byte {
	var replyContent string

	switch msg.MsgType {
	case "event":
		switch msg.Event {
		case "subscribe":
			h.logger.InfoContext(ctx, "wechat mp callback: user subscribed", "openid", msg.FromUserName, "event_key", msg.EventKey)
			// 扫码关注的 EventKey 形如 "qrscene_<scene>"；普通关注无 scene 不做绑定。
			scene := usecase.ExtractScene(msg.EventKey, true)
			if scene != "" && scene != msg.EventKey {
				if reply, err := h.usecase.HandleBindEvent(ctx, scene, msg.FromUserName); err != nil {
					h.logger.ErrorContext(ctx, "wechat mp callback: handle bind on subscribe failed", "error", err)
				} else {
					replyContent = reply
				}
			}
			if replyContent == "" {
				replyContent = defaultReplySubscribe
			}

		case "unsubscribe":
			h.logger.InfoContext(ctx, "wechat mp callback: user unsubscribed", "openid", msg.FromUserName)
			if err := h.usecase.HandleUnsubscribe(ctx, msg.FromUserName); err != nil {
				h.logger.ErrorContext(ctx, "wechat mp callback: handle unsubscribe failed", "error", err, "openid", msg.FromUserName)
			}
			return []byte("success")

		case "SCAN":
			h.logger.InfoContext(ctx, "wechat mp callback: user scanned", "openid", msg.FromUserName, "event_key", msg.EventKey)
			// 已关注用户扫码：EventKey 即 scene
			if reply, err := h.usecase.HandleBindEvent(ctx, msg.EventKey, msg.FromUserName); err != nil {
				h.logger.ErrorContext(ctx, "wechat mp callback: handle bind on scan failed", "error", err)
			} else {
				replyContent = reply
			}
			if replyContent == "" {
				replyContent = defaultReplyScan
			}

		case "CLICK":
			h.logger.InfoContext(ctx, "wechat mp callback: menu clicked", "openid", msg.FromUserName, "event_key", msg.EventKey)
			replyContent = defaultReplyClick

		default:
			h.logger.InfoContext(ctx, "wechat mp callback: unknown event", "event", msg.Event, "openid", msg.FromUserName)
			return []byte("success")
		}

	case "text":
		h.logger.InfoContext(ctx, "wechat mp callback: text received", "openid", msg.FromUserName, "content", msg.Content)
		replyContent = defaultReplyText

	default:
		h.logger.InfoContext(ctx, "wechat mp callback: unknown msg type", "type", msg.MsgType, "openid", msg.FromUserName)
		return []byte("success")
	}

	reply := msgpush.ReplyMessage{
		ToUserName:   msg.FromUserName,
		FromUserName: msg.ToUserName,
		CreateTime:   time.Now().Unix(),
		MsgType:      "text",
		Content:      replyContent,
	}
	out, err := xml.Marshal(reply)
	if err != nil {
		h.logger.ErrorContext(ctx, "wechat mp callback: marshal reply failed", "error", err)
		return []byte("success")
	}
	return out
}

func getQuery(q map[string][]string, key string) string {
	if vs, ok := q[key]; ok && len(vs) > 0 {
		return vs[0]
	}
	return ""
}

func writeText(w http.ResponseWriter, status int, body string) {
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
