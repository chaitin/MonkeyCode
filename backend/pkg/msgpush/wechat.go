package msgpush

import (
	"context"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// access_token Redis 共享缓存相关常量。
//
// 微信公众号 access_token 对每个 AppID 全局唯一，后取作废先取。如果 binary 内有
// 多份 WechatClient 实例（如内部 monkeycode-ai 桥接出的实例 + backend do 容器
// 实例），各自维护进程内缓存会互相把对方的 token 顶失效，进入 40001 抢夺循环。
//
// 解法：把 token 放 Redis，key 用 AppID 做命名空间（兼容未来多公众号）；
// 进程内用 singleflight 合并并发，进程间用 SETNX 防惊群。
const (
	accessTokenKeyPrefix      = "wechat:mp:access_token:"
	accessTokenLockSuffix     = ":lock"
	accessTokenLockTTL        = 10 * time.Second // 调微信 /token 一般 <1s，10s 足以覆盖网络抖动
	accessTokenLockRetryEvery = 200 * time.Millisecond
	accessTokenLockMaxWait    = 5 * time.Second // 等持锁者的最长时间；超时回退到本次自己尝试拿锁
	accessTokenSafetyMargin   = 300             // 比微信返回的 expires_in 提前 5 分钟失效
)

// WechatClient 微信公众号客户端
type WechatClient struct {
	cfg    *config.Config
	logger *slog.Logger

	// access_token 走 Redis 共享缓存，进程内用 singleflight 合并并发 refresh
	redis        *redis.Client
	refreshGroup singleflight.Group

	// 微信 API 客户端
	wechatClient *request.Client

	// 安全模式消息加解密，非 nil 表示启用安全模式
	msgCrypt *MsgCrypt
}

// NewWechatClient 创建微信公众号客户端。
//
// redis 用于跨进程共享 access_token；同 binary 内不同 WechatClient 实例传入同一个
// redis client，即可避免抢夺。详见 accessTokenKeyPrefix 注释。
func NewWechatClient(cfg *config.Config, logger *slog.Logger, rdb *redis.Client) *WechatClient {
	client := &WechatClient{
		cfg:          cfg,
		logger:       logger.With("module", "wechat_mp.client"),
		redis:        rdb,
		wechatClient: request.NewClient("https", "api.weixin.qq.com", 30*time.Second),
	}

	// 配置了 EncodingAESKey 则启用安全模式
	if cfg.Wechat.MP.EncodingAESKey != "" {
		mc, err := NewMsgCrypt(cfg.Wechat.MP.Token, cfg.Wechat.MP.EncodingAESKey, cfg.Wechat.MP.AppID)
		if err != nil {
			client.logger.Error("wechat mp client: init MsgCrypt failed, falling back to plain mode", "error", err)
		} else {
			client.msgCrypt = mc
			client.logger.Info("wechat mp client: MsgCrypt enabled (safe mode)")
		}
	}

	return client
}

// AccessTokenResp 微信 access_token 响应
type AccessTokenResp struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

func (c *WechatClient) tokenKey() string {
	return accessTokenKeyPrefix + c.cfg.Wechat.MP.AppID
}

func (c *WechatClient) tokenLockKey() string {
	return c.tokenKey() + accessTokenLockSuffix
}

// GetAccessToken 获取微信 access_token。
//
// 流程：
//  1. 先读 Redis 共享缓存，命中直接返回。
//  2. 用 singleflight 合并同进程并发 refresh 请求。
//  3. SETNX 跨进程锁；持锁者调微信 /token 并写回 Redis，其他实例轮询等待
//     （等不到就自己重试拿锁，避免持锁者崩溃后无限等待）。
func (c *WechatClient) GetAccessToken(ctx context.Context) (string, error) {
	if token, err := c.redis.Get(ctx, c.tokenKey()).Result(); err == nil && token != "" {
		return token, nil
	} else if err != nil && !errors.Is(err, redis.Nil) {
		c.logger.WarnContext(ctx, "wechat mp token: cache read failed, will refresh", "error", err)
	}

	v, err, _ := c.refreshGroup.Do(c.tokenKey(), func() (any, error) {
		return c.refreshAccessToken(ctx)
	})
	if err != nil {
		return "", err
	}
	return v.(string), nil
}

// refreshAccessToken 在持锁者位置调微信 /token；非持锁者轮询 Redis 等结果。
func (c *WechatClient) refreshAccessToken(ctx context.Context) (string, error) {
	lockKey := c.tokenLockKey()
	tokenKey := c.tokenKey()
	lockValue := fmt.Sprintf("%d", time.Now().UnixNano())

	deadline := time.Now().Add(accessTokenLockMaxWait)
	for {
		// SETNX 尝试拿跨进程锁
		ok, err := c.redis.SetNX(ctx, lockKey, lockValue, accessTokenLockTTL).Result()
		if err != nil {
			c.logger.WarnContext(ctx, "wechat mp token: lock SETNX failed, calling /token directly", "error", err)
			return c.fetchAndStoreToken(ctx)
		}
		if ok {
			defer c.releaseLock(ctx, lockKey, lockValue)
			// 拿到锁后再 double-check Redis，可能是别的实例刚刚写入 + 释放锁的窗口
			if token, err := c.redis.Get(ctx, tokenKey).Result(); err == nil && token != "" {
				return token, nil
			}
			return c.fetchAndStoreToken(ctx)
		}

		// 没拿到锁：等持锁者写完 token
		if time.Now().After(deadline) {
			c.logger.WarnContext(ctx, "wechat mp token: lock wait timeout, attempting direct fetch", "lock_key", lockKey)
			return c.fetchAndStoreToken(ctx)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(accessTokenLockRetryEvery):
		}
		if token, err := c.redis.Get(ctx, tokenKey).Result(); err == nil && token != "" {
			return token, nil
		}
	}
}

// fetchAndStoreToken 调微信 /cgi-bin/token 拿新 token 并写入 Redis。
func (c *WechatClient) fetchAndStoreToken(ctx context.Context) (string, error) {
	resp, err := request.Get[AccessTokenResp](c.wechatClient, ctx, "/cgi-bin/token", request.WithQuery(
		request.Query{
			"grant_type": "client_credential",
			"appid":      c.cfg.Wechat.MP.AppID,
			"secret":     c.cfg.Wechat.MP.AppSecret,
		},
	))
	if err != nil {
		c.logger.ErrorContext(ctx, "wechat mp token: refresh failed", "error", err)
		return "", fmt.Errorf("failed to get wechat access_token: %w", err)
	}
	if resp.ErrCode != 0 {
		c.logger.ErrorContext(ctx, "wechat mp token: api returned error", "errcode", resp.ErrCode, "errmsg", resp.ErrMsg)
		return "", fmt.Errorf("wechat error: %d - %s", resp.ErrCode, resp.ErrMsg)
	}

	ttl := time.Duration(resp.ExpiresIn-accessTokenSafetyMargin) * time.Second
	if ttl <= 0 {
		// 微信极少返回小于 safety margin 的 expires_in，但兜底防止负数 TTL 立即清除
		ttl = time.Duration(resp.ExpiresIn) * time.Second
	}
	if err := c.redis.Set(ctx, c.tokenKey(), resp.AccessToken, ttl).Err(); err != nil {
		// Redis 写失败不致命：本次返回的 token 仍然有效，只是其他实例下次还得自己拿
		c.logger.WarnContext(ctx, "wechat mp token: redis write failed", "error", err)
	}
	c.logger.InfoContext(ctx, "wechat mp token: refreshed", "expires_in", resp.ExpiresIn)
	return resp.AccessToken, nil
}

// releaseLock 用 Lua 保证只删自己持有的锁，避免误删后到者刚拿到的锁。
func (c *WechatClient) releaseLock(ctx context.Context, lockKey, lockValue string) {
	const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`
	if err := c.redis.Eval(ctx, script, []string{lockKey}, lockValue).Err(); err != nil && !errors.Is(err, redis.Nil) {
		c.logger.WarnContext(ctx, "wechat mp token: lock release failed", "error", err)
	}
}

// ClearAccessToken 删除 Redis 共享缓存，强制下次重新拉取。
// 用于 token 过期被微信返回 40001 时主动清除。
func (c *WechatClient) ClearAccessToken() {
	// ctx 用 background，调用方通常在错误处理路径，不应受调用方 ctx 取消影响
	if err := c.redis.Del(context.Background(), c.tokenKey()).Err(); err != nil {
		c.logger.Warn("wechat mp token: clear failed", "error", err)
	}
}

// VerifySignature 验证微信服务器签名
func (c *WechatClient) VerifySignature(signature, timestamp, nonce string) bool {
	token := c.cfg.Wechat.MP.Token
	if token == "" {
		c.logger.Warn("wechat mp callback: token not configured")
		return false
	}

	params := []string{token, timestamp, nonce}
	sort.Strings(params)

	str := strings.Join(params, "")
	hash := sha1.New()
	hash.Write([]byte(str))
	hashStr := hex.EncodeToString(hash.Sum(nil))

	return subtle.ConstantTimeCompare([]byte(hashStr), []byte(signature)) == 1
}

// Message 微信推送的消息结构
type Message struct {
	XMLName      xml.Name `xml:"xml"`
	ToUserName   string   `xml:"ToUserName"`
	FromUserName string   `xml:"FromUserName"`
	CreateTime   int64    `xml:"CreateTime"`
	MsgType      string   `xml:"MsgType"`
	Event        string   `xml:"Event"`
	EventKey     string   `xml:"EventKey"`
	Ticket       string   `xml:"Ticket"`
	Content      string   `xml:"Content"`
	MsgID        int64    `xml:"MsgId"`
}

// ReplyMessage 微信回复消息结构
type ReplyMessage struct {
	XMLName      xml.Name `xml:"xml"`
	ToUserName   string   `xml:"ToUserName"`
	FromUserName string   `xml:"FromUserName"`
	CreateTime   int64    `xml:"CreateTime"`
	MsgType      string   `xml:"MsgType"`
	Content      string   `xml:"Content,omitempty"`
}

// EventHandler 微信事件处理回调函数类型，返回可选的回复文本
type EventHandler func(ctx context.Context, msg *Message) (string, error)

// ParseMessage 解析微信推送的消息
func (c *WechatClient) ParseMessage(body io.Reader) (*Message, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	var msg Message
	if err := xml.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal xml: %w", err)
	}

	return &msg, nil
}

// IsEncryptedMode 当前是否启用安全模式（msgCrypt 已初始化且回调声明 encrypt_type=aes）。
// handler 用它决定 GET/POST 走加密分支还是明文分支。
func (c *WechatClient) IsEncryptedMode(encryptType string) bool {
	return c.msgCrypt != nil && encryptType == "aes"
}

// DecryptEchoStr 解密 GET 校验回调中的 echostr。仅在 IsEncryptedMode 为 true 时调用。
func (c *WechatClient) DecryptEchoStr(msgSignature, timestamp, nonce, echostr string) (string, error) {
	return c.msgCrypt.DecryptEchoStr(msgSignature, timestamp, nonce, echostr)
}

// DecryptMessage 解密 POST 推送的消息体。仅在 IsEncryptedMode 为 true 时调用。
func (c *WechatClient) DecryptMessage(msgSignature, timestamp, nonce string, body []byte) ([]byte, error) {
	return c.msgCrypt.DecryptMessage(msgSignature, timestamp, nonce, body)
}

// EncryptMessage 加密回复内容。仅在 IsEncryptedMode 为 true 时调用。
func (c *WechatClient) EncryptMessage(reply []byte, timestamp, nonce string) ([]byte, error) {
	return c.msgCrypt.EncryptMessage(reply, timestamp, nonce)
}

// ========== 二维码相关 ==========

// QRCodeCreateReq 创建临时二维码请求
type QRCodeCreateReq struct {
	ExpireSeconds int              `json:"expire_seconds"`
	ActionName    string           `json:"action_name"`
	ActionInfo    QRCodeActionInfo `json:"action_info"`
}

// QRCodeActionInfo 二维码动作信息
type QRCodeActionInfo struct {
	Scene QRCodeScene `json:"scene"`
}

// QRCodeScene 二维码场景值
type QRCodeScene struct {
	SceneStr string `json:"scene_str,omitempty"`
	SceneID  int    `json:"scene_id,omitempty"`
}

// QRCodeCreateResp 创建临时二维码响应
type QRCodeCreateResp struct {
	Ticket        string `json:"ticket"`
	ExpireSeconds int    `json:"expire_seconds"`
	URL           string `json:"url"`
	ErrCode       int    `json:"errcode"`
	ErrMsg        string `json:"errmsg"`
}

// wechatErrCoder 微信 API 响应的错误码接口
type wechatErrCoder interface {
	wechatErr() (int, string)
}

func (r QRCodeCreateResp) wechatErr() (int, string)    { return r.ErrCode, r.ErrMsg }
func (r MPUserInfoResp) wechatErr() (int, string)      { return r.ErrCode, r.ErrMsg }
func (r TemplateMessageResp) wechatErr() (int, string) { return r.ErrCode, r.ErrMsg }

// isTokenExpiredErr 判断是否为 access_token 过期错误
func isTokenExpiredErr(code int) bool {
	return code == 40001 || code == 42001
}

// withTokenRetry 带 token 过期自动重试的通用调用方法
func withTokenRetry[T wechatErrCoder](ctx context.Context, c *WechatClient, fn func(token string) (*T, error)) (*T, error) {
	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get access_token: %w", err)
	}

	resp, err := fn(token)
	if err != nil {
		return nil, err
	}

	code, msg := (*resp).wechatErr()
	if code == 0 {
		return resp, nil
	}

	if !isTokenExpiredErr(code) {
		return nil, fmt.Errorf("wechat error: %d - %s", code, msg)
	}

	// token 过期，刷新后重试一次
	c.ClearAccessToken()
	token, err = c.GetAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to refresh access_token: %w", err)
	}

	resp, err = fn(token)
	if err != nil {
		return nil, err
	}

	code, msg = (*resp).wechatErr()
	if code != 0 {
		return nil, fmt.Errorf("wechat error: %d - %s", code, msg)
	}

	return resp, nil
}

// CreateQRCode 创建临时二维码
func (c *WechatClient) CreateQRCode(ctx context.Context, scene string, expireSeconds int) (*QRCodeCreateResp, error) {
	req := &QRCodeCreateReq{
		ExpireSeconds: expireSeconds,
		ActionName:    "QR_STR_SCENE",
		ActionInfo: QRCodeActionInfo{
			Scene: QRCodeScene{SceneStr: scene},
		},
	}

	return withTokenRetry(ctx, c, func(token string) (*QRCodeCreateResp, error) {
		return request.Post[QRCodeCreateResp](c.wechatClient, ctx, "/cgi-bin/qrcode/create",
			req,
			request.WithQuery(request.Query{"access_token": token}),
		)
	})
}

// ========== 用户信息 ==========

// MPUserInfoResp 公众号用户信息响应
type MPUserInfoResp struct {
	Subscribe     int    `json:"subscribe"`
	OpenID        string `json:"openid"`
	Nickname      string `json:"nickname"`
	Sex           int    `json:"sex"`
	Language      string `json:"language"`
	City          string `json:"city"`
	Province      string `json:"province"`
	Country       string `json:"country"`
	HeadImgURL    string `json:"headimgurl"`
	SubscribeTime int64  `json:"subscribe_time"`
	UnionID       string `json:"unionid"`
	Remark        string `json:"remark"`
	GroupID       int    `json:"groupid"`
	ErrCode       int    `json:"errcode"`
	ErrMsg        string `json:"errmsg"`
}

// GetMPUserInfo 获取公众号关注用户信息
func (c *WechatClient) GetMPUserInfo(ctx context.Context, openID string) (*MPUserInfoResp, error) {
	return withTokenRetry(ctx, c, func(token string) (*MPUserInfoResp, error) {
		return request.Get[MPUserInfoResp](c.wechatClient, ctx, "/cgi-bin/user/info",
			request.WithQuery(request.Query{
				"access_token": token,
				"openid":       openID,
				"lang":         "zh_CN",
			}),
		)
	})
}

// ========== 模板消息推送 ==========

// TemplateMessageData 模板消息数据项
type TemplateMessageData struct {
	Value string `json:"value"`
	Color string `json:"color,omitempty"`
}

// TemplateMessage 模板消息请求体
type TemplateMessage struct {
	ToUser      string                         `json:"touser"`
	TemplateID  string                         `json:"template_id"`
	URL         string                         `json:"url,omitempty"`
	MiniProgram *TemplateMiniProgram           `json:"miniprogram,omitempty"`
	Data        map[string]TemplateMessageData `json:"data"`
}

// TemplateMiniProgram 小程序跳转配置
type TemplateMiniProgram struct {
	AppID    string `json:"appid"`
	PagePath string `json:"pagepath"`
}

// TemplateMessageResp 模板消息发送响应
type TemplateMessageResp struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	MsgID   int64  `json:"msgid"`
}

// SendTemplateMessage 发送模板消息
func (c *WechatClient) SendTemplateMessage(ctx context.Context, msg *TemplateMessage) error {
	resp, err := withTokenRetry(ctx, c, func(token string) (*TemplateMessageResp, error) {
		return request.Post[TemplateMessageResp](c.wechatClient, ctx, "/cgi-bin/message/template/send",
			msg,
			request.WithQuery(request.Query{"access_token": token}),
		)
	})
	if err != nil {
		c.logger.ErrorContext(ctx, "failed to send template message", "error", err, "touser", msg.ToUser)
		return fmt.Errorf("failed to send template message: %w", err)
	}

	c.logger.InfoContext(ctx, "template message sent", "touser", msg.ToUser, "msgid", resp.MsgID)
	return nil
}

// ========== HTTP Handler 辅助方法 ==========
//
// 微信回调的 HTTP 接收/路由/回复全部在 biz/notify/handler/v1/wechat_callback.go。
// 本文件只暴露协议原语（ParseMessage / VerifySignature / IsEncryptedMode /
// Decrypt* / EncryptMessage），handler 层组合它们处理回调。
