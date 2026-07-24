package endpoint

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/GoYoko/web"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/endpoint"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

const (
	protocolVersion  = 1
	directoryChannel = "endpoint:directory"
)

var methodPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,127}$`)

type bridgeConfig struct {
	maxEndpoints      int
	maxFrameBytes     int64
	queueMessages     int
	queueBytes        int64
	messageRate       int
	byteRate          int64
	heartbeatInterval time.Duration
	heartbeatTimeout  time.Duration
	presenceTTL       time.Duration
	allowedOrigins    []string
	debug             bool
}

type Bridge struct {
	db                *db.Client
	redis             *redis.Client
	session           *session.Session
	logger            *slog.Logger
	instanceID        string
	config            bridgeConfig
	ctx               context.Context
	cancel            context.CancelFunc
	pubsub            *redis.PubSub
	connsMu           sync.RWMutex
	conns             map[string]*clientConn
	presenceMu        sync.Mutex
	presenceState     map[uuid.UUID]string
	subscriptionReady atomic.Bool
	closed            atomic.Bool
}

type clientConn struct {
	userID         uuid.UUID
	machineID      uuid.UUID
	generation     string
	cookie         string
	conn           *websocket.Conn
	queue          chan []byte
	queueMu        sync.Mutex
	queueBytes     int64
	rateViolations int
	done           chan struct{}
	closeOnce      sync.Once
}

type presence struct {
	InstanceID string `json:"instance_id"`
	Generation string `json:"generation"`
}

type routedMessage struct {
	Kind             string          `json:"kind"`
	UserID           uuid.UUID       `json:"user_id"`
	Target           uuid.UUID       `json:"target"`
	TargetGeneration string          `json:"target_generation"`
	Source           uuid.UUID       `json:"source,omitempty"`
	SourceInstance   string          `json:"source_instance,omitempty"`
	SourceGeneration string          `json:"source_generation,omitempty"`
	ReplyTo          uuid.UUID       `json:"reply_to,omitempty"`
	Payload          json.RawMessage `json:"payload,omitempty"`
	ErrorCode        string          `json:"error_code,omitempty"`
}

type directoryEvent struct {
	UserID uuid.UUID `json:"user_id"`
}

func newBridge(client *db.Client, rdb *redis.Client, cfg *config.Config, logger *slog.Logger) *Bridge {
	instanceID := strings.TrimSpace(cfg.EndpointBridge.InstanceID)
	if instanceID == "" {
		host, _ := os.Hostname()
		instanceID = host + "-" + uuid.NewString()
	}
	ctx, cancel := context.WithCancel(context.Background())
	b := &Bridge{
		db:            client,
		redis:         rdb,
		logger:        logger.With("module", "endpoint.bridge", "instance_id", instanceID),
		instanceID:    instanceID,
		config:        resolveBridgeConfig(cfg),
		ctx:           ctx,
		cancel:        cancel,
		conns:         make(map[string]*clientConn),
		presenceState: make(map[uuid.UUID]string),
	}
	b.pubsub = rdb.Subscribe(ctx, directoryChannel, instanceChannel(instanceID))
	if _, err := b.pubsub.ReceiveTimeout(ctx, time.Second); err != nil {
		b.logger.WarnContext(ctx, "订阅端点路由频道失败", "error", err)
	} else {
		b.subscriptionReady.Store(true)
	}
	go b.consumePubSub()
	go b.watchPresence()
	return b
}

func resolveBridgeConfig(cfg *config.Config) bridgeConfig {
	duration := func(value string, fallback time.Duration) time.Duration {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed <= 0 {
			return fallback
		}
		return parsed
	}
	positive := func(value, fallback int) int {
		if value <= 0 {
			return fallback
		}
		return value
	}
	positive64 := func(value, fallback int64) int64 {
		if value <= 0 {
			return fallback
		}
		return value
	}
	return bridgeConfig{
		maxEndpoints:      positive(cfg.EndpointBridge.MaxEndpoints, 20),
		maxFrameBytes:     positive64(cfg.EndpointBridge.MaxFrameBytes, 256<<10),
		queueMessages:     positive(cfg.EndpointBridge.QueueMessages, 128),
		queueBytes:        positive64(cfg.EndpointBridge.QueueBytes, 4<<20),
		messageRate:       positive(cfg.EndpointBridge.MessageRate, 100),
		byteRate:          positive64(cfg.EndpointBridge.ByteRate, 4<<20),
		heartbeatInterval: duration(cfg.EndpointBridge.HeartbeatInterval, 30*time.Second),
		heartbeatTimeout:  duration(cfg.EndpointBridge.HeartbeatTimeout, 10*time.Second),
		presenceTTL:       duration(cfg.EndpointBridge.PresenceTTL, 60*time.Second),
		allowedOrigins:    slices.Clone(cfg.EndpointBridge.AllowedOrigins),
		debug:             cfg.Debug,
	}
}

func (b *Bridge) Register(w *web.Web, auth *middleware.AuthMiddleware) {
	b.session = auth.Session
	group := w.Group("/api/v1/endpoints")
	endpointAuth := b.endpointAuth(auth)
	group.Use(endpointAuth)
	group.GET("", web.BaseHandler(b.List))
	group.GET("/connect", web.BaseHandler(b.Connect))
	group.GET("/:machine_id", web.BindHandler(b.Get))
	group.POST("/:machine_id/revoke", web.BindHandler(b.Revoke))
	group.POST("/:machine_id/restore", web.BindHandler(b.Restore))
	w.Echo().PATCH("/api/v1/endpoints/:machine_id", b.Update, endpointAuth)
	w.Echo().Server.RegisterOnShutdown(b.Close)
	w.Echo().TLSServer.RegisterOnShutdown(b.Close)
}

func (b *Bridge) endpointAuth(auth *middleware.AuthMiddleware) echo.MiddlewareFunc {
	protected := auth.Auth()
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		handler := protected(next)
		return func(c echo.Context) error {
			err := handler(c)
			if c.Response().Status == http.StatusUnauthorized {
				b.logger.WarnContext(c.Request().Context(), "端点鉴权失败",
					"security_audit", true,
					"event", "endpoint.authentication_failed",
					"path", c.Path(),
					"source_ip", c.RealIP(),
					"user_agent", c.Request().UserAgent(),
				)
			}
			return err
		}
	}
}

func (b *Bridge) Close() {
	if !b.closed.CompareAndSwap(false, true) {
		return
	}
	b.cancel()
	if b.pubsub != nil {
		_ = b.pubsub.Close()
	}
	b.connsMu.RLock()
	conns := make([]*clientConn, 0, len(b.conns))
	for _, conn := range b.conns {
		conns = append(conns, conn)
	}
	b.connsMu.RUnlock()
	for _, conn := range conns {
		conn.close(websocket.StatusServiceRestart, "service restart")
	}
}

// List 获取当前用户的全部端点
//
//	@Summary		获取端点列表
//	@Description	返回当前登录用户登记过的全部端点，包括 active 和 revoked 状态。online 表示端点当前是否持有有效在线租约；last_seen_at、created_at、updated_at 均为 Unix 毫秒时间戳。
//	@Tags			【用户】端点桥接
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=[]domain.EndpointView}	"成功"
//	@Failure		401	{object}	web.Resp								"登录会话无效"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/endpoints [get]
func (b *Bridge) List(c *web.Context) error {
	user := middleware.GetUser(c)
	items, err := b.listEndpoints(c.Request().Context(), user.ID, true)
	if err != nil {
		return err
	}
	return c.Success(items)
}

// Get 获取指定端点
//
//	@Summary		获取端点详情
//	@Description	按安装级 machine_id 查询当前登录用户自己的端点。其他用户的端点与不存在的端点统一返回资源不存在，避免跨用户枚举。
//	@Tags			【用户】端点桥接
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			machine_id	path		string								true	"安装实例首次启动生成的 UUIDv4 机器标识"	Format(uuid)
//	@Success		200			{object}	web.Resp{data=domain.EndpointView}	"成功"
//	@Failure		400			{object}	web.Resp							"machine_id 格式无效"
//	@Failure		401			{object}	web.Resp							"登录会话无效"
//	@Failure		404			{object}	web.Resp							"端点不存在"
//	@Failure		500			{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/endpoints/{machine_id} [get]
func (b *Bridge) Get(c *web.Context, req domain.EndpointPathReq) error {
	user := middleware.GetUser(c)
	item, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(req.MachineID)).
		Only(c.Request().Context())
	if db.IsNotFound(err) {
		return errcode.ErrNotFound
	}
	if err != nil {
		return err
	}
	view := b.endpointView(c.Request().Context(), item, true)
	return c.Success(view)
}

// Update 修改端点别名
//
//	@Summary		修改端点别名
//	@Description	修改当前登录用户指定端点的展示别名。alias 为 null、空字符串或仅含空白字符时清除别名；别名最长 128 个 Unicode 字符。后续 hello 上报只更新系统设备资料，不会覆盖别名。
//	@Tags			【用户】端点桥接
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			machine_id	path		string								true	"安装实例首次启动生成的 UUIDv4 机器标识"	Format(uuid)
//	@Param			req			body		domain.UpdateEndpointReq			true	"端点别名；null 或空字符串表示清除"
//	@Success		200			{object}	web.Resp{data=domain.EndpointView}	"成功"
//	@Failure		400			{object}	web.Resp							"请求参数无效或别名过长"
//	@Failure		401			{object}	web.Resp							"登录会话无效"
//	@Failure		404			{object}	web.Resp							"端点不存在"
//	@Failure		500			{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/endpoints/{machine_id} [patch]
func (b *Bridge) Update(c echo.Context) error {
	machineID, err := uuid.Parse(c.Param("machine_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]any{"code": http.StatusBadRequest, "message": "machine_id 无效"})
	}
	var body domain.UpdateEndpointReq
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]any{"code": http.StatusBadRequest, "message": "请求体无效"})
	}
	user := middleware.GetUser(c)
	query := b.db.Endpoint.Update().Where(endpoint.UserID(user.ID), endpoint.MachineID(machineID))
	if body.Alias == nil || strings.TrimSpace(*body.Alias) == "" {
		query.ClearAlias()
	} else {
		alias := strings.TrimSpace(*body.Alias)
		if len([]rune(alias)) > 128 {
			return c.JSON(http.StatusBadRequest, map[string]any{"code": http.StatusBadRequest, "message": "端点别名过长"})
		}
		query.SetAlias(alias)
	}
	affected, err := query.Save(c.Request().Context())
	if err != nil {
		return err
	}
	if affected == 0 {
		return c.JSON(http.StatusNotFound, map[string]any{"code": http.StatusNotFound, "message": "端点不存在"})
	}
	b.publishDirectory(user.ID)
	item, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(machineID)).
		Only(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{
		"code":    0,
		"message": "success",
		"data":    b.endpointView(c.Request().Context(), item, true),
	})
}

// Revoke 撤销指定端点
//
//	@Summary		撤销端点
//	@Description	将当前登录用户的端点标记为 revoked，并立即关闭该端点的在线连接。被撤销端点不会出现在 WebSocket 目录中，也不能通过 hello 自动重新登记；撤销不等同于撤销该设备上的登录会话。
//	@Tags			【用户】端点桥接
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			machine_id	path		string										true	"安装实例首次启动生成的 UUIDv4 机器标识"	Format(uuid)
//	@Success		200			{object}	web.Resp{data=domain.EndpointStatusResp}	"成功，status 为 revoked"
//	@Failure		400			{object}	web.Resp									"machine_id 格式无效"
//	@Failure		401			{object}	web.Resp									"登录会话无效"
//	@Failure		404			{object}	web.Resp									"端点不存在"
//	@Failure		500			{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/endpoints/{machine_id}/revoke [post]
func (b *Bridge) Revoke(c *web.Context, req domain.EndpointPathReq) error {
	user := middleware.GetUser(c)
	affected, err := b.db.Endpoint.Update().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(req.MachineID)).
		SetStatus(domain.EndpointStatusRevoked).
		Save(c.Request().Context())
	if err != nil {
		return err
	}
	if affected == 0 {
		return errcode.ErrNotFound
	}
	b.disconnectEndpoint(c.Request().Context(), user.ID, req.MachineID, websocket.StatusCode(4002), "endpoint revoked")
	b.publishDirectory(user.ID)
	b.logger.InfoContext(c.Request().Context(), "端点已撤销",
		"security_audit", true,
		"event", "endpoint.revoked",
		"user_id", user.ID,
		"machine_id", req.MachineID,
	)
	return c.Success(map[string]any{"machine_id": req.MachineID, "status": domain.EndpointStatusRevoked})
}

// Restore 恢复指定端点
//
//	@Summary		恢复端点
//	@Description	将当前登录用户已撤销的端点恢复为 active。接口幂等，端点已启用时仍返回成功；恢复后的端点可以重新建立桥接连接。当未撤销端点已达到部署配置上限时返回业务错误码 10009。
//	@Tags			【用户】端点桥接
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			machine_id	path		string										true	"安装实例首次启动生成的 UUIDv4 机器标识"	Format(uuid)
//	@Success		200			{object}	web.Resp{data=domain.EndpointStatusResp}	"成功，status 为 active"
//	@Failure		400			{object}	web.Resp									"machine_id 格式无效"
//	@Failure		401			{object}	web.Resp									"登录会话无效"
//	@Failure		404			{object}	web.Resp									"端点不存在"
//	@Failure		500			{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/endpoints/{machine_id}/restore [post]
func (b *Bridge) Restore(c *web.Context, req domain.EndpointPathReq) error {
	ctx := c.Request().Context()
	user := middleware.GetUser(c)
	item, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(req.MachineID)).
		Only(ctx)
	if db.IsNotFound(err) {
		return errcode.ErrNotFound
	}
	if err != nil {
		return err
	}
	if item.Status == domain.EndpointStatusActive {
		return c.Success(map[string]any{"machine_id": req.MachineID, "status": domain.EndpointStatusActive})
	}
	unlock, err := b.acquireRegistrationLock(ctx, user.ID)
	if err != nil {
		return err
	}
	defer unlock()
	item, err = b.db.Endpoint.Query().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(req.MachineID)).
		Only(ctx)
	if db.IsNotFound(err) {
		return errcode.ErrNotFound
	}
	if err != nil {
		return err
	}
	if item.Status == domain.EndpointStatusActive {
		return c.Success(map[string]any{"machine_id": req.MachineID, "status": domain.EndpointStatusActive})
	}
	count, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(user.ID), endpoint.StatusEQ(domain.EndpointStatusActive)).
		Count(ctx)
	if err != nil {
		return err
	}
	if count >= b.config.maxEndpoints {
		return errcode.ErrEndpointLimitExceeded
	}
	affected, err := b.db.Endpoint.Update().
		Where(endpoint.UserID(user.ID), endpoint.MachineID(req.MachineID)).
		SetStatus(domain.EndpointStatusActive).
		Save(ctx)
	if err != nil {
		return err
	}
	if affected == 0 {
		return errcode.ErrNotFound
	}
	b.publishDirectory(user.ID)
	b.logger.InfoContext(ctx, "端点已恢复",
		"security_audit", true,
		"event", "endpoint.restored",
		"user_id", user.ID,
		"machine_id", req.MachineID,
	)
	return c.Success(map[string]any{"machine_id": req.MachineID, "status": domain.EndpointStatusActive})
}

// Connect 建立端点桥接 WebSocket
//
//	@Summary		建立端点桥接连接
//	@Description	该路由用于 WebSocket Upgrade，不是普通 REST 查询。原生桌面端和移动端复用当前登录 Cookie 连接；生产环境必须使用 WSS，非空 Origin 必须匹配服务端白名单。
//	@Description	Upgrade 成功后，客户端须在 5 秒内发送 hello 文本帧，包含支持的协议主版本、安装级 UUIDv4 machine_id 和设备资料。服务端返回 welcome，并立即发送同一用户全部未撤销端点的 directory.snapshot 全量快照。
//	@Description	业务帧仅支持 UTF-8 JSON 文本格式的 event、request、response；单帧最大 256 KiB，不支持二进制帧和压缩。完整消息结构、关闭码和重连规则见 docs/design/2026-07-17-client-bridge-client-protocol.md。
//	@Tags			【用户】端点桥接
//	@Security		MonkeyCodeAIAuth
//	@Param			Upgrade		header		string	true	"固定为 websocket"
//	@Param			Connection	header		string	true	"包含 Upgrade"
//	@Success		101			{string}	string	"切换到 WebSocket 协议；后续通过文本帧交换 hello、welcome、directory.snapshot 和业务消息"
//	@Failure		401			{string}	string	"登录会话无效"
//	@Failure		403			{string}	string	"必须使用 WSS 或 Origin 不受信任"
//	@Router			/api/v1/endpoints/connect [get]
func (b *Bridge) Connect(c *web.Context) error {
	if err := b.validateUpgrade(c.Request()); err != nil {
		return c.String(http.StatusForbidden, err.Error())
	}
	user := middleware.GetUser(c)
	cookie, err := c.Cookie(consts.MonkeyCodeAISession)
	if err != nil {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}
	conn, err := websocket.Accept(c.Response(), c.Request(), &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
		OriginPatterns:  b.config.allowedOrigins,
	})
	if err != nil {
		return nil
	}
	conn.SetReadLimit(b.config.maxFrameBytes)

	hello, err := b.readHello(conn)
	if err != nil {
		b.closeForError(conn, err)
		return nil
	}
	record, err := b.upsertEndpoint(c.Request().Context(), user.ID, hello)
	if err != nil {
		b.writeHandshakeError(conn, err)
		return nil
	}
	client, err := b.attach(c.Request().Context(), user.ID, hello.MachineID, cookie.Value, conn)
	if err != nil {
		b.writeHandshakeError(conn, err)
		return nil
	}
	defer b.detach(client)

	go b.writeLoop(client)
	b.enqueueSystem(client, map[string]any{
		"type":             "welcome",
		"protocol_version": protocolVersion,
		"server_time":      time.Now().UnixMilli(),
		"heartbeat": map[string]any{
			"interval_ms": b.config.heartbeatInterval.Milliseconds(),
			"timeout_ms":  b.config.heartbeatTimeout.Milliseconds(),
		},
		"limits": map[string]any{
			"max_frame_bytes": b.config.maxFrameBytes,
			"max_endpoints":   b.config.maxEndpoints,
		},
	})
	_ = record
	b.sendDirectory(client)
	b.publishDirectory(user.ID)
	go b.heartbeat(client)
	b.readLoop(client)
	return nil
}

func (b *Bridge) validateUpgrade(r *http.Request) error {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	if !secure && (!b.config.debug || !isLoopbackHost(r.Host)) {
		return errors.New("只允许 WSS，开发环境本机地址除外")
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return nil
	}
	for _, allowed := range b.config.allowedOrigins {
		if origin == strings.TrimSpace(allowed) {
			return nil
		}
	}
	return errors.New("来源不受信任")
}

func isLoopbackHost(address string) bool {
	host := address
	if parsed, _, err := net.SplitHostPort(address); err == nil {
		host = parsed
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (b *Bridge) readHello(conn *websocket.Conn) (domain.EndpointHello, error) {
	ctx, cancel := context.WithTimeout(b.ctx, 5*time.Second)
	defer cancel()
	messageType, raw, err := conn.Read(ctx)
	if err != nil {
		return domain.EndpointHello{}, err
	}
	if messageType != websocket.MessageText {
		return domain.EndpointHello{}, errUnsupportedData
	}
	if int64(len(raw)) > b.config.maxFrameBytes {
		return domain.EndpointHello{}, errFrameTooLarge
	}
	var hello domain.EndpointHello
	if err := json.Unmarshal(raw, &hello); err != nil {
		return hello, errInvalidMessage
	}
	if hello.Type != "hello" || hello.MachineID == uuid.Nil || !slices.Contains(hello.ProtocolVersions, protocolVersion) {
		return hello, errUnsupportedProtocol
	}
	if !validProfile(hello.Profile) {
		return hello, errInvalidMessage
	}
	return hello, nil
}

func validProfile(profile domain.EndpointProfile) bool {
	if strings.TrimSpace(profile.DeviceName) == "" ||
		strings.TrimSpace(profile.OSVersion) == "" ||
		strings.TrimSpace(profile.Arch) == "" ||
		strings.TrimSpace(profile.ClientVersion) == "" {
		return false
	}
	switch profile.Platform {
	case "macos", "windows", "linux", "ios", "android":
		return true
	default:
		return false
	}
}

func (b *Bridge) upsertEndpoint(ctx context.Context, userID uuid.UUID, hello domain.EndpointHello) (*db.Endpoint, error) {
	item, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(userID), endpoint.MachineID(hello.MachineID)).
		Only(ctx)
	if err == nil {
		if item.Status == domain.EndpointStatusRevoked {
			return nil, errEndpointRevoked
		}
		return item.Update().
			SetDeviceName(hello.Profile.DeviceName).
			SetPlatform(endpoint.Platform(hello.Profile.Platform)).
			SetOsVersion(hello.Profile.OSVersion).
			SetArch(hello.Profile.Arch).
			SetClientVersion(hello.Profile.ClientVersion).
			SetProtocolVersion(protocolVersion).
			SetLastSeenAt(time.Now()).
			Save(ctx)
	}
	if !db.IsNotFound(err) {
		return nil, err
	}
	unlock, err := b.acquireRegistrationLock(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	item, err = b.db.Endpoint.Query().
		Where(endpoint.UserID(userID), endpoint.MachineID(hello.MachineID)).
		Only(ctx)
	if err == nil {
		if item.Status == domain.EndpointStatusRevoked {
			return nil, errEndpointRevoked
		}
		return item.Update().
			SetDeviceName(hello.Profile.DeviceName).
			SetPlatform(endpoint.Platform(hello.Profile.Platform)).
			SetOsVersion(hello.Profile.OSVersion).
			SetArch(hello.Profile.Arch).
			SetClientVersion(hello.Profile.ClientVersion).
			SetProtocolVersion(protocolVersion).
			SetLastSeenAt(time.Now()).
			Save(ctx)
	}
	if !db.IsNotFound(err) {
		return nil, err
	}
	count, err := b.db.Endpoint.Query().
		Where(endpoint.UserID(userID), endpoint.StatusEQ(domain.EndpointStatusActive)).
		Count(ctx)
	if err != nil {
		return nil, err
	}
	if count >= b.config.maxEndpoints {
		return nil, errEndpointLimit
	}
	item, err = b.db.Endpoint.Create().
		SetUserID(userID).
		SetMachineID(hello.MachineID).
		SetDeviceName(hello.Profile.DeviceName).
		SetPlatform(endpoint.Platform(hello.Profile.Platform)).
		SetOsVersion(hello.Profile.OSVersion).
		SetArch(hello.Profile.Arch).
		SetClientVersion(hello.Profile.ClientVersion).
		SetProtocolVersion(protocolVersion).
		SetLastSeenAt(time.Now()).
		Save(ctx)
	if err == nil {
		b.logger.InfoContext(ctx, "端点已登记",
			"security_audit", true,
			"event", "endpoint.registered",
			"user_id", userID,
			"machine_id", hello.MachineID,
		)
	}
	return item, err
}

func (b *Bridge) attach(ctx context.Context, userID, machineID uuid.UUID, cookie string, conn *websocket.Conn) (*clientConn, error) {
	if !b.subscriptionReady.Load() {
		return nil, errServiceUnavailable
	}
	if err := b.redis.Ping(ctx).Err(); err != nil {
		return nil, errServiceUnavailable
	}
	generation := uuid.NewString()
	location := presence{InstanceID: b.instanceID, Generation: generation}
	raw, _ := json.Marshal(location)
	key := presenceKey(userID, machineID)
	oldRaw, err := replacePresenceScript.Run(ctx, b.redis, []string{key}, string(raw), b.config.presenceTTL.Milliseconds()).Text()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, errServiceUnavailable
	}
	client := &clientConn{
		userID:     userID,
		machineID:  machineID,
		generation: generation,
		cookie:     cookie,
		conn:       conn,
		queue:      make(chan []byte, b.config.queueMessages),
		done:       make(chan struct{}),
	}
	connKey := localConnectionKey(userID, machineID)
	b.connsMu.Lock()
	oldLocal := b.conns[connKey]
	b.conns[connKey] = client
	b.connsMu.Unlock()
	replaced := oldLocal != nil && oldLocal != client
	if oldLocal != nil && oldLocal != client {
		oldLocal.close(websocket.StatusCode(4001), "connection replaced")
	}
	if oldRaw != "" {
		var old presence
		if json.Unmarshal([]byte(oldRaw), &old) == nil && old.Generation != generation && old.InstanceID != b.instanceID {
			replaced = true
			command, _ := json.Marshal(routedMessage{
				Kind:             "close",
				UserID:           userID,
				Target:           machineID,
				TargetGeneration: old.Generation,
			})
			_ = b.redis.Publish(ctx, instanceChannel(old.InstanceID), command).Err()
		}
	}
	if replaced {
		b.logger.InfoContext(ctx, "端点连接已替换",
			"security_audit", true,
			"event", "endpoint.connection_replaced",
			"user_id", userID,
			"machine_id", machineID,
		)
	}
	return client, nil
}

func (b *Bridge) detach(client *clientConn) {
	client.close(websocket.StatusNormalClosure, "")
	b.connsMu.Lock()
	key := localConnectionKey(client.userID, client.machineID)
	if b.conns[key] == client {
		delete(b.conns, key)
	}
	b.connsMu.Unlock()
	_, _ = b.db.Endpoint.Update().
		Where(endpoint.UserID(client.userID), endpoint.MachineID(client.machineID)).
		SetLastSeenAt(time.Now()).
		Save(context.Background())
	_, _ = deletePresenceScript.Run(
		context.Background(),
		b.redis,
		[]string{presenceKey(client.userID, client.machineID)},
		b.instanceID,
		client.generation,
	).Result()
	b.publishDirectory(client.userID)
}

func (b *Bridge) readLoop(client *clientConn) {
	for {
		messageType, raw, err := client.conn.Read(b.ctx)
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			client.close(websocket.StatusUnsupportedData, "text frames only")
			return
		}
		if int64(len(raw)) > b.config.maxFrameBytes {
			client.close(websocket.StatusMessageTooBig, "frame too large")
			return
		}
		envelope, err := normalizeEnvelope(raw, client)
		if err != nil {
			b.enqueueError(client, envelope.MessageID, protocolErrorCode(err), false, 0)
			continue
		}
		if !b.allowMessage(client, len(raw)) {
			client.rateViolations++
			b.enqueueError(client, envelope.MessageID, "rate_limited", true, time.Second)
			if client.rateViolations >= 3 {
				client.close(websocket.StatusPolicyViolation, "rate limit exceeded")
				return
			}
			continue
		}
		client.rateViolations = 0
		b.route(client, envelope)
	}
}

func normalizeEnvelope(raw []byte, client *clientConn) (domain.EndpointEnvelope, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return domain.EndpointEnvelope{}, errInvalidMessage
	}
	if _, exists := fields["source"]; exists {
		return domain.EndpointEnvelope{}, errInvalidMessage
	}
	if _, exists := fields["routed_at"]; exists {
		return domain.EndpointEnvelope{}, errInvalidMessage
	}
	var envelope domain.EndpointEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return envelope, errInvalidMessage
	}
	if envelope.MessageID == uuid.Nil || envelope.MessageID.Version() != 4 || envelope.Target == uuid.Nil {
		return envelope, errInvalidMessage
	}
	var payload map[string]any
	if len(envelope.Payload) == 0 || json.Unmarshal(envelope.Payload, &payload) != nil || payload == nil {
		return envelope, errInvalidMessage
	}
	switch envelope.Type {
	case "event", "request":
		if !methodPattern.MatchString(envelope.Method) || envelope.ReplyTo != nil {
			return envelope, errInvalidMessage
		}
	case "response":
		if envelope.ReplyTo == nil || envelope.ReplyTo.Version() != 4 || envelope.Method != "" {
			return envelope, errInvalidMessage
		}
	default:
		return envelope, errInvalidMessage
	}
	source := client.machineID
	now := time.Now().UnixMilli()
	envelope.Source = &source
	envelope.RoutedAt = &now
	return envelope, nil
}

func (b *Bridge) route(source *clientConn, envelope domain.EndpointEnvelope) {
	ctx := b.ctx
	exists, err := b.db.Endpoint.Query().
		Where(
			endpoint.UserID(source.userID),
			endpoint.MachineID(envelope.Target),
			endpoint.StatusEQ(domain.EndpointStatusActive),
		).
		Exist(ctx)
	if err != nil {
		b.enqueueError(source, envelope.MessageID, "service_unavailable", true, time.Second)
		return
	}
	if !exists {
		b.enqueueError(source, envelope.MessageID, "target_unavailable", false, 0)
		return
	}
	rawLocation, err := b.redis.Get(ctx, presenceKey(source.userID, envelope.Target)).Bytes()
	if errors.Is(err, redis.Nil) {
		b.enqueueError(source, envelope.MessageID, "target_offline", true, time.Second)
		return
	}
	if err != nil {
		b.enqueueError(source, envelope.MessageID, "service_unavailable", true, time.Second)
		return
	}
	var location presence
	if json.Unmarshal(rawLocation, &location) != nil {
		b.enqueueError(source, envelope.MessageID, "stale_route", true, 0)
		return
	}
	payload, err := json.Marshal(envelope)
	if err != nil || int64(len(payload)) > b.config.maxFrameBytes {
		b.enqueueError(source, envelope.MessageID, "payload_too_large", false, 0)
		return
	}
	if location.InstanceID == b.instanceID {
		target := b.localConnection(source.userID, envelope.Target)
		if target == nil || target.generation != location.Generation {
			b.enqueueError(source, envelope.MessageID, "stale_route", true, 0)
			return
		}
		if !b.enqueueBusiness(target, payload) {
			b.enqueueError(source, envelope.MessageID, "target_busy", true, time.Second)
		}
		return
	}
	message, _ := json.Marshal(routedMessage{
		Kind:             "route",
		UserID:           source.userID,
		Target:           envelope.Target,
		TargetGeneration: location.Generation,
		Source:           source.machineID,
		SourceInstance:   b.instanceID,
		SourceGeneration: source.generation,
		ReplyTo:          envelope.MessageID,
		Payload:          payload,
	})
	subscribers, err := b.redis.Publish(ctx, instanceChannel(location.InstanceID), message).Result()
	if err != nil || subscribers == 0 {
		b.enqueueError(source, envelope.MessageID, "target_unavailable", true, time.Second)
	}
}

func (b *Bridge) allowMessage(client *clientConn, size int) bool {
	now := time.Now().Unix()
	userKey := fmt.Sprintf("endpoint:rate:user:%s:%d", client.userID, now)
	clientKey := fmt.Sprintf("endpoint:rate:client:%s:%s:%d", client.userID, client.machineID, now)
	values, err := rateScript.Run(
		b.ctx,
		b.redis,
		[]string{userKey, clientKey},
		size,
		b.config.messageRate,
		b.config.byteRate,
	).Int64Slice()
	return err == nil && len(values) == 4 &&
		values[0] <= int64(b.config.messageRate) &&
		values[1] <= b.config.byteRate &&
		values[2] <= int64(b.config.messageRate) &&
		values[3] <= b.config.byteRate
}

func (b *Bridge) writeLoop(client *clientConn) {
	for {
		select {
		case <-client.done:
			return
		case payload := <-client.queue:
			ctx, cancel := context.WithTimeout(b.ctx, b.config.heartbeatTimeout)
			err := client.conn.Write(ctx, websocket.MessageText, payload)
			cancel()
			client.queueMu.Lock()
			client.queueBytes -= int64(len(payload))
			client.queueMu.Unlock()
			if err != nil {
				client.close(websocket.StatusInternalError, "write failed")
				return
			}
		}
	}
}

func (b *Bridge) enqueueBusiness(client *clientConn, payload []byte) bool {
	client.queueMu.Lock()
	defer client.queueMu.Unlock()
	if client.queueBytes+int64(len(payload)) > b.config.queueBytes {
		return false
	}
	select {
	case client.queue <- payload:
		client.queueBytes += int64(len(payload))
		return true
	default:
		return false
	}
}

func (b *Bridge) enqueueSystem(client *clientConn, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		return
	}
	if !b.enqueueBusiness(client, payload) {
		client.close(websocket.StatusTryAgainLater, "client too slow")
	}
}

func (b *Bridge) enqueueError(client *clientConn, replyTo uuid.UUID, code string, retryable bool, retryAfter time.Duration) {
	message := map[string]any{
		"type": "error",
		"error": map[string]any{
			"code":      code,
			"message":   protocolErrorMessage(code),
			"retryable": retryable,
		},
	}
	if replyTo != uuid.Nil {
		message["reply_to"] = replyTo
	}
	if retryAfter > 0 {
		message["error"].(map[string]any)["retry_after_ms"] = retryAfter.Milliseconds()
	}
	b.enqueueSystem(client, message)
}

func (b *Bridge) heartbeat(client *clientConn) {
	ticker := time.NewTicker(b.config.heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-client.done:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(b.ctx, b.config.heartbeatTimeout)
			if err := client.conn.Ping(ctx); err != nil {
				cancel()
				client.close(websocket.StatusInternalError, "heartbeat failed")
				return
			}
			valid, err := b.session.Check(ctx, consts.MonkeyCodeAISession, client.cookie)
			if err != nil {
				cancel()
				client.close(websocket.StatusTryAgainLater, "session check unavailable")
				return
			}
			if !valid {
				cancel()
				b.logger.Info("端点会话已失效",
					"security_audit", true,
					"event", "endpoint.session_expired",
					"user_id", client.userID,
					"machine_id", client.machineID,
				)
				client.close(websocket.StatusCode(4003), "session expired")
				return
			}
			renewed, err := renewPresenceScript.Run(
				ctx,
				b.redis,
				[]string{presenceKey(client.userID, client.machineID)},
				b.instanceID,
				client.generation,
				b.config.presenceTTL.Milliseconds(),
			).Int()
			cancel()
			if err != nil || renewed < 0 {
				client.close(websocket.StatusTryAgainLater, "presence unavailable")
				return
			}
			if renewed == 0 {
				client.close(websocket.StatusCode(4001), "connection replaced")
				return
			}
		}
	}
}

func (b *Bridge) sendDirectory(client *clientConn) {
	items, err := b.listEndpoints(b.ctx, client.userID, false)
	if err != nil {
		b.enqueueError(client, uuid.Nil, "service_unavailable", true, time.Second)
		return
	}
	b.enqueueSystem(client, map[string]any{"type": "directory.snapshot", "endpoints": items})
}

func (b *Bridge) listEndpoints(ctx context.Context, userID uuid.UUID, includeRevoked bool) ([]domain.EndpointView, error) {
	query := b.db.Endpoint.Query().Where(endpoint.UserID(userID)).Order(endpoint.ByCreatedAt())
	if !includeRevoked {
		query.Where(endpoint.StatusEQ(domain.EndpointStatusActive))
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	views := make([]domain.EndpointView, 0, len(items))
	for _, item := range items {
		views = append(views, b.endpointView(ctx, item, includeRevoked))
	}
	return views, nil
}

func (b *Bridge) endpointView(ctx context.Context, item *db.Endpoint, includeStatus bool) domain.EndpointView {
	createdAt := item.CreatedAt.UnixMilli()
	updatedAt := item.UpdatedAt.UnixMilli()
	var lastSeen *int64
	if item.LastSeenAt != nil {
		value := item.LastSeenAt.UnixMilli()
		lastSeen = &value
	}
	displayName := item.DeviceName
	if item.Alias != nil {
		displayName = *item.Alias
	}
	view := domain.EndpointView{
		MachineID:       item.MachineID,
		DeviceName:      item.DeviceName,
		Alias:           item.Alias,
		DisplayName:     displayName,
		Platform:        string(item.Platform),
		OSVersion:       item.OsVersion,
		Arch:            item.Arch,
		ClientVersion:   item.ClientVersion,
		ProtocolVersion: item.ProtocolVersion,
		Online:          b.redis.Exists(ctx, presenceKey(item.UserID, item.MachineID)).Val() == 1,
		LastSeenAt:      lastSeen,
	}
	if includeStatus {
		view.Status = string(item.Status)
		view.CreatedAt = &createdAt
		view.UpdatedAt = &updatedAt
	}
	return view
}

func (b *Bridge) publishDirectory(userID uuid.UUID) {
	payload, _ := json.Marshal(directoryEvent{UserID: userID})
	if err := b.redis.Publish(context.Background(), directoryChannel, payload).Err(); err != nil {
		b.logger.Warn("发布端点目录失败", "user_id", userID, "error", err)
	}
}

func (b *Bridge) consumePubSub() {
	channel := b.pubsub.Channel()
	for {
		select {
		case <-b.ctx.Done():
			return
		case message, ok := <-channel:
			if !ok {
				b.subscriptionReady.Store(false)
				return
			}
			if message.Channel == directoryChannel {
				var event directoryEvent
				if json.Unmarshal([]byte(message.Payload), &event) == nil {
					b.broadcastDirectory(event.UserID)
				}
				continue
			}
			var routed routedMessage
			if json.Unmarshal([]byte(message.Payload), &routed) == nil {
				b.handleRoutedMessage(routed)
			}
		}
	}
}

func (b *Bridge) broadcastDirectory(userID uuid.UUID) {
	b.connsMu.RLock()
	targets := make([]*clientConn, 0)
	for _, client := range b.conns {
		if client.userID == userID {
			targets = append(targets, client)
		}
	}
	b.connsMu.RUnlock()
	for _, client := range targets {
		b.sendDirectory(client)
	}
}

func (b *Bridge) watchPresence() {
	interval := b.config.heartbeatInterval
	if interval > 10*time.Second {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-b.ctx.Done():
			return
		case <-ticker.C:
			b.checkPresenceChanges()
		}
	}
}

func (b *Bridge) checkPresenceChanges() {
	b.connsMu.RLock()
	users := make(map[uuid.UUID]struct{})
	for _, client := range b.conns {
		users[client.userID] = struct{}{}
	}
	b.connsMu.RUnlock()
	for userID := range users {
		items, err := b.db.Endpoint.Query().
			Where(endpoint.UserID(userID), endpoint.StatusEQ(domain.EndpointStatusActive)).
			Order(endpoint.ByMachineID()).
			All(b.ctx)
		if err != nil {
			continue
		}
		online := make([]string, 0, len(items))
		failed := false
		for _, item := range items {
			exists, err := b.redis.Exists(b.ctx, presenceKey(userID, item.MachineID)).Result()
			if err != nil {
				failed = true
				break
			}
			if exists == 1 {
				online = append(online, item.MachineID.String())
			}
		}
		if failed {
			continue
		}
		state := strings.Join(online, ",")
		b.presenceMu.Lock()
		previous, known := b.presenceState[userID]
		b.presenceState[userID] = state
		b.presenceMu.Unlock()
		if known && previous != state {
			b.publishDirectory(userID)
		}
	}
}

func (b *Bridge) handleRoutedMessage(message routedMessage) {
	target := b.localConnection(message.UserID, message.Target)
	switch message.Kind {
	case "route":
		code := ""
		if target == nil || target.generation != message.TargetGeneration {
			code = "stale_route"
		} else if !b.enqueueBusiness(target, message.Payload) {
			code = "target_busy"
		}
		if code != "" {
			payload, _ := json.Marshal(routedMessage{
				Kind:             "route_error",
				UserID:           message.UserID,
				Target:           message.Source,
				TargetGeneration: message.SourceGeneration,
				ReplyTo:          message.ReplyTo,
				ErrorCode:        code,
			})
			_ = b.redis.Publish(b.ctx, instanceChannel(message.SourceInstance), payload).Err()
		}
	case "route_error":
		if target != nil && target.generation == message.TargetGeneration {
			b.enqueueError(target, message.ReplyTo, message.ErrorCode, true, time.Second)
		}
	case "close":
		if target != nil && target.generation == message.TargetGeneration {
			target.close(websocket.StatusCode(4001), "connection replaced")
		}
	case "revoke":
		if target != nil && target.generation == message.TargetGeneration {
			target.close(websocket.StatusCode(4002), "endpoint revoked")
		}
	}
}

func (b *Bridge) localConnection(userID, machineID uuid.UUID) *clientConn {
	b.connsMu.RLock()
	defer b.connsMu.RUnlock()
	return b.conns[localConnectionKey(userID, machineID)]
}

func (b *Bridge) disconnectEndpoint(ctx context.Context, userID, machineID uuid.UUID, status websocket.StatusCode, reason string) {
	raw, err := b.redis.Get(ctx, presenceKey(userID, machineID)).Bytes()
	if err != nil {
		return
	}
	var location presence
	if json.Unmarshal(raw, &location) != nil {
		return
	}
	if location.InstanceID == b.instanceID {
		if client := b.localConnection(userID, machineID); client != nil && client.generation == location.Generation {
			client.close(status, reason)
		}
		return
	}
	kind := "close"
	if status == websocket.StatusCode(4002) {
		kind = "revoke"
	}
	payload, _ := json.Marshal(routedMessage{
		Kind:             kind,
		UserID:           userID,
		Target:           machineID,
		TargetGeneration: location.Generation,
	})
	_ = b.redis.Publish(ctx, instanceChannel(location.InstanceID), payload).Err()
}

func (b *Bridge) acquireRegistrationLock(ctx context.Context, userID uuid.UUID) (func(), error) {
	lockCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	token := uuid.NewString()
	key := "endpoint:registration:" + userID.String()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		err := b.redis.SetArgs(lockCtx, key, token, redis.SetArgs{
			Mode: string(redis.NX),
			TTL:  5 * time.Second,
		}).Err()
		if err != nil && !errors.Is(err, redis.Nil) {
			cancel()
			return nil, errServiceUnavailable
		}
		if err == nil {
			cancel()
			return func() {
				_, _ = releaseLockScript.Run(context.Background(), b.redis, []string{key}, token).Result()
			}, nil
		}
		select {
		case <-lockCtx.Done():
			cancel()
			return nil, errServiceUnavailable
		case <-ticker.C:
		}
	}
}

func (c *clientConn) close(status websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close(status, reason)
	})
}

func localConnectionKey(userID, machineID uuid.UUID) string {
	return userID.String() + ":" + machineID.String()
}

func presenceKey(userID, machineID uuid.UUID) string {
	return "endpoint:presence:" + localConnectionKey(userID, machineID)
}

func instanceChannel(instanceID string) string {
	return "endpoint:instance:" + instanceID
}

var (
	errInvalidMessage      = errors.New("invalid message")
	errUnsupportedProtocol = errors.New("unsupported protocol")
	errEndpointRevoked     = errors.New("endpoint revoked")
	errEndpointLimit       = errors.New("endpoint limit exceeded")
	errServiceUnavailable  = errors.New("service unavailable")
	errFrameTooLarge       = errors.New("frame too large")
	errUnsupportedData     = errors.New("unsupported data")
)

func (b *Bridge) writeHandshakeError(conn *websocket.Conn, err error) {
	code := protocolErrorCode(err)
	payload, _ := json.Marshal(map[string]any{
		"type": "error",
		"error": map[string]any{
			"code":      code,
			"message":   protocolErrorMessage(code),
			"retryable": code == "service_unavailable",
		},
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	_ = conn.Write(ctx, websocket.MessageText, payload)
	cancel()
	_ = conn.Close(handshakeCloseStatus(err), protocolErrorMessage(code))
}

func handshakeCloseStatus(err error) websocket.StatusCode {
	switch {
	case errors.Is(err, errUnsupportedProtocol):
		return websocket.StatusProtocolError
	case errors.Is(err, errEndpointRevoked):
		return websocket.StatusCode(4002)
	case errors.Is(err, errFrameTooLarge):
		return websocket.StatusMessageTooBig
	case errors.Is(err, errUnsupportedData):
		return websocket.StatusUnsupportedData
	case errors.Is(err, errServiceUnavailable):
		return websocket.StatusTryAgainLater
	default:
		return websocket.StatusPolicyViolation
	}
}

func (b *Bridge) closeForError(conn *websocket.Conn, err error) {
	if errors.Is(err, errFrameTooLarge) {
		_ = conn.Close(websocket.StatusMessageTooBig, "frame too large")
		return
	}
	b.writeHandshakeError(conn, err)
}

func protocolErrorCode(err error) string {
	switch {
	case errors.Is(err, errUnsupportedProtocol):
		return "unsupported_protocol"
	case errors.Is(err, errEndpointRevoked):
		return "endpoint_revoked"
	case errors.Is(err, errEndpointLimit):
		return "endpoint_limit_exceeded"
	case errors.Is(err, errServiceUnavailable):
		return "service_unavailable"
	case errors.Is(err, errFrameTooLarge):
		return "payload_too_large"
	default:
		return "invalid_message"
	}
}

func protocolErrorMessage(code string) string {
	switch code {
	case "invalid_message":
		return "消息格式无效"
	case "unsupported_protocol":
		return "协议版本不兼容"
	case "endpoint_revoked":
		return "端点已撤销"
	case "endpoint_limit_exceeded":
		return "端点数量已达上限"
	case "target_unavailable":
		return "目标端点不可用"
	case "target_offline":
		return "目标端点当前离线"
	case "target_busy":
		return "目标端点繁忙"
	case "stale_route":
		return "目标路由已变化"
	case "rate_limited":
		return "发送频率超过限制"
	case "payload_too_large":
		return "消息超过大小限制"
	case "service_unavailable":
		return "桥接服务暂不可用"
	default:
		return code
	}
}

var replacePresenceScript = redis.NewScript(`
local old = redis.call("GET", KEYS[1])
redis.call("PSETEX", KEYS[1], ARGV[2], ARGV[1])
return old
`)

var deletePresenceScript = redis.NewScript(`
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.instance_id == ARGV[1] and decoded.generation == ARGV[2] then
  return redis.call("DEL", KEYS[1])
end
return 0
`)

var renewPresenceScript = redis.NewScript(`
local current = redis.call("GET", KEYS[1])
if not current then return -1 end
local decoded = cjson.decode(current)
if decoded.instance_id == ARGV[1] and decoded.generation == ARGV[2] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[3])
end
return 0
`)

var rateScript = redis.NewScript(`
local user_messages = redis.call("HINCRBY", KEYS[1], "messages", 1)
local user_bytes = redis.call("HINCRBY", KEYS[1], "bytes", ARGV[1])
local client_messages = redis.call("HINCRBY", KEYS[2], "messages", 1)
local client_bytes = redis.call("HINCRBY", KEYS[2], "bytes", ARGV[1])
redis.call("EXPIRE", KEYS[1], 2)
redis.call("EXPIRE", KEYS[2], 2)
return {user_messages, user_bytes, client_messages, client_bytes}
`)

var releaseLockScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`)
