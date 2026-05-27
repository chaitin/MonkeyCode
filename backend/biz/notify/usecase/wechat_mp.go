package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/notifychannel"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/msgpush"
)

const (
	// wechatMPScenePrefix 是二维码 scene 的前缀，用于网关按前缀路由到对应后端
	wechatMPScenePrefix     = "mcai:"
	wechatMPBindScenePrefix = "wechat_mp_bind:"
	wechatMPBindSceneTTL    = 5 * time.Minute
)

// WechatMPUsecaseImpl 微信公众号绑定业务实现
type WechatMPUsecaseImpl struct {
	db           *db.Client
	wechatClient *msgpush.WechatClient
	redis        *redis.Client
	config       *config.Config
	logger       *slog.Logger
}

// NewWechatMPUsecase 创建微信公众号绑定 usecase
func NewWechatMPUsecase(i *do.Injector) (domain.WechatMPUsecase, error) {
	return &WechatMPUsecaseImpl{
		db:           do.MustInvoke[*db.Client](i),
		wechatClient: do.MustInvoke[*msgpush.WechatClient](i),
		redis:        do.MustInvoke[*redis.Client](i),
		config:       do.MustInvoke[*config.Config](i),
		logger:       do.MustInvoke[*slog.Logger](i).With("module", "wechat_mp.usecase"),
	}, nil
}

// CreateBindQRCode 创建绑定二维码
func (u *WechatMPUsecaseImpl) CreateBindQRCode(ctx context.Context, userID uuid.UUID) (*domain.BindQRCodeResp, error) {
	sceneID := uuid.NewString()
	scene := wechatMPScenePrefix + sceneID

	redisKey := wechatMPBindScenePrefix + sceneID
	if err := u.redis.Set(ctx, redisKey, userID.String(), wechatMPBindSceneTTL).Err(); err != nil {
		return nil, fmt.Errorf("failed to set bind scene in redis: %w", err)
	}

	expireSeconds := int(wechatMPBindSceneTTL.Seconds())
	qrResp, err := u.wechatClient.CreateQRCode(ctx, scene, expireSeconds)
	if err != nil {
		u.redis.Del(ctx, redisKey)
		return nil, fmt.Errorf("failed to create qrcode: %w", err)
	}

	return &domain.BindQRCodeResp{
		QRCodeURL: fmt.Sprintf("https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=%s", url.QueryEscape(qrResp.Ticket)),
		Ticket:    qrResp.Ticket,
		ExpireSec: qrResp.ExpireSeconds,
	}, nil
}

// Unbind 解除绑定
func (u *WechatMPUsecaseImpl) Unbind(ctx context.Context, userID uuid.UUID) error {
	n, err := u.db.NotifyChannel.Update().
		Where(
			notifychannel.OwnerIDEQ(userID),
			notifychannel.KindEQ(consts.NotifyChannelWechatMP),
			notifychannel.EnabledEQ(true),
		).
		SetEnabled(false).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("failed to unbind: %w", err)
	}
	if n == 0 {
		return errcode.ErrWechatMPNotBound
	}
	return nil
}

// HandleBindEvent 处理绑定事件（subscribe 带 scene 或 SCAN 事件）
// scene 格式为 "mcai:{uuid}"，由 ExtractScene 从 EventKey 中提取
func (u *WechatMPUsecaseImpl) HandleBindEvent(ctx context.Context, scene, mpOpenID string) (string, error) {
	if scene == "" {
		return "", nil
	}

	sceneID := strings.TrimPrefix(scene, wechatMPScenePrefix)
	if sceneID == scene {
		return "", nil
	}

	redisKey := wechatMPBindScenePrefix + sceneID
	userIDStr, err := u.redis.Get(ctx, redisKey).Result()
	if err == redis.Nil {
		u.logger.InfoContext(ctx, "wechat mp bind: scene expired or not found", "scene", scene, "openid", mpOpenID)
		return "二维码已过期，请重新获取。", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get bind scene from redis: %w", err)
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return "", fmt.Errorf("invalid user_id in bind scene: %w", err)
	}

	// 拿到 user_id 后 derive sub-logger，后续 bind 流程所有日志都带 user_id + openid
	logger := u.logger.With("user_id", userID, "openid", mpOpenID)

	var unionID string
	userInfo, err := u.wechatClient.GetMPUserInfo(ctx, mpOpenID)
	if err != nil {
		logger.WarnContext(ctx, "wechat mp bind: get user info failed, proceeding without unionid", "error", err)
	} else {
		unionID = userInfo.UnionID
	}

	now := time.Now()
	metadata := map[string]string{
		"union_id":      unionID,
		"last_bound_at": now.Format(time.RFC3339),
	}

	existing, err := u.db.NotifyChannel.Query().
		Where(
			notifychannel.OwnerIDEQ(userID),
			notifychannel.KindEQ(consts.NotifyChannelWechatMP),
		).
		First(ctx)

	if err != nil && !db.IsNotFound(err) {
		return "", fmt.Errorf("failed to query notify channel: %w", err)
	}

	if existing != nil {
		_, err := existing.Update().
			SetTargetID(mpOpenID).
			SetMetadata(metadata).
			SetEnabled(true).
			Save(ctx)
		if err != nil {
			return "", fmt.Errorf("failed to update notify channel: %w", err)
		}
	} else {
		_, err := u.db.NotifyChannel.Create().
			SetOwnerID(userID).
			SetOwnerType(consts.NotifyOwnerUser).
			SetName("微信公众号").
			SetKind(consts.NotifyChannelWechatMP).
			SetWebhookURL("").
			SetTargetID(mpOpenID).
			SetMetadata(metadata).
			SetEnabled(true).
			Save(ctx)
		if err != nil {
			// 并发扫码：T1/T2 同时 Query 都看到无 → 都走 Create 路径。
			// partial unique idx_notify_channels_wechat_mp_owner 会让后到的事务报 ConstraintError，
			// 这里退化为重查后 Update，保证后到的回调也能完成绑定（target_id 覆盖为最新 openid）。
			if !db.IsConstraintError(err) {
				return "", fmt.Errorf("failed to create notify channel: %w", err)
			}
			winner, qerr := u.db.NotifyChannel.Query().
				Where(
					notifychannel.OwnerIDEQ(userID),
					notifychannel.KindEQ(consts.NotifyChannelWechatMP),
				).
				First(ctx)
			if qerr != nil {
				return "", fmt.Errorf("failed to re-query after constraint conflict: %w", qerr)
			}
			_, err := winner.Update().
				SetTargetID(mpOpenID).
				SetMetadata(metadata).
				SetEnabled(true).
				Save(ctx)
			if err != nil {
				return "", fmt.Errorf("failed to update after constraint conflict: %w", err)
			}
		}
	}

	u.redis.Del(ctx, redisKey)

	logger.InfoContext(ctx, "wechat mp bind: success", "union_id", unionID)

	// 拉用户名拼到回复里；查不到就用兜底文案，不阻断绑定流程。
	userName := ""
	if usr, err := u.db.User.Query().Where(user.IDEQ(userID)).Only(ctx); err != nil {
		logger.WarnContext(ctx, "wechat mp bind: query user name failed", "error", err)
	} else {
		userName = usr.Name
	}

	// Nginx mirror 模式下 inline reply 会被丢弃，需要主动调微信 API 推一条模板消息兜底。
	// 单后端部署关闭此开关，否则用户会收到两次"绑定成功"。
	if u.config.Wechat.MP.MirrorMode {
		bindMsg := &msgpush.TemplateMessage{
			ToUser: mpOpenID,
			Data: map[string]msgpush.TemplateMessageData{
				"thing2": {Value: "绑定成功"},
				"thing5": {Value: "您已成功绑定 MonkeyCode 通知，后续将收到任务进度提醒。"},
				"time3":  {Value: time.Now().Format("2006-01-02 15:04:05")},
			},
		}
		if err := u.wechatClient.SendTemplateMessage(ctx, bindMsg); err != nil {
			logger.WarnContext(ctx, "wechat mp bind: send confirmation failed", "error", err)
		}
	}

	return fmt.Sprintf("已绑定 MonkeyCode 账号 “%s”，你将在这里收到任务执行通知", userName), nil
}

// HandleUnsubscribe 处理取消关注事件
func (u *WechatMPUsecaseImpl) HandleUnsubscribe(ctx context.Context, mpOpenID string) error {
	now := time.Now()

	channels, err := u.db.NotifyChannel.Query().
		Where(
			notifychannel.TargetIDEQ(mpOpenID),
			notifychannel.KindEQ(consts.NotifyChannelWechatMP),
		).
		All(ctx)
	if err != nil {
		return fmt.Errorf("failed to query channels: %w", err)
	}
	if len(channels) == 0 {
		u.logger.WarnContext(ctx, "wechat mp unbind: no binding found", "openid", mpOpenID)
		return nil
	}

	for _, ch := range channels {
		meta := ch.Metadata
		if meta == nil {
			meta = map[string]string{}
		}
		meta["last_unsubscribed_at"] = now.Format(time.RFC3339)
		if _, err := ch.Update().
			SetEnabled(false).
			SetMetadata(meta).
			Save(ctx); err != nil {
			return fmt.Errorf("failed to disable channel %s: %w", ch.ID, err)
		}
	}
	return nil
}

// ExtractScene 从 EventKey 中提取 scene 值
// subscribe 事件的 EventKey 格式: qrscene_mcai:{uuid}
// SCAN 事件的 EventKey 格式: mcai:{uuid}
func ExtractScene(eventKey string, isSubscribe bool) string {
	if isSubscribe {
		return strings.TrimPrefix(eventKey, "qrscene_")
	}
	return eventKey
}
