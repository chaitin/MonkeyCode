// [INPUT]: 设备登记、身份授权、yamux 会话与结构化日志。
// [OUTPUT]: 组装 relay 服务，按代次回收设备访问并记录首次关闭原因。
// [POS]: relay 服务入口，按控制或数据通道分配复用器的超时预算。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/hashicorp/yamux"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	controlProbeInterval = 15 * time.Second
	controlSilenceLimit  = 45 * time.Second
)

type Config struct {
	DesktopOrigins        []string
	PreviewOriginTemplate string
	StateDir              string
	ServerID              string
	PublicURL             string
	FilesOrigin           string
	VerificationKeysFile  string
	SigningKeyFile        string
	MaxDevices            int
}

type Service struct {
	pool             *pgxpool.Pool
	identity         *identity.Service
	devices          *endpoint.Execution
	logger           *slog.Logger
	config           Config
	verificationKeys []map[string]string
	key              ed25519.PrivateKey
	kid              string
	workers          sync.WaitGroup
	mu               sync.Mutex
	routes           map[target]*route
	gates            [64]sync.Mutex
	slots            int
	limiter          map[string]rateWindow
	active           map[*websocket.Conn]struct{}
	draining         atomic.Bool
	metrics          relayMetrics
}

type rateWindow struct {
	start time.Time
	count int
}

type target struct{ user, machine string }

type connectionVersion struct {
	version       int64
	accessVersion int64
	expires       time.Time
}

type route struct {
	eventsActive       bool
	leaseSequences     map[string]int64
	runtimeStatus      string
	engineHealth       string
	controlQueue       chan any
	target             target
	principal          identity.Principal
	hello              Hello
	state              endpoint.ExecutionState
	control            *yamux.Session
	data               *yamux.Session
	ws                 *websocket.Conn
	ready              bool
	closed             bool
	seen               time.Time
	slotsControl       chan struct{}
	opensControl       chan struct{}
	dataBudget         *dataBudget
	connectionVersions map[string]connectionVersion
	streams            map[*access]struct{}
}

func NewService(pool *pgxpool.Pool, identities *identity.Service, devices *endpoint.Execution, logger *slog.Logger, config Config) (*Service, error) {
	if config.ServerID != "" && !validUUID(config.ServerID) {
		return nil, errors.New("远程执行 server_id 必须为稳定 UUIDv4")
	}
	if config.FilesOrigin == "" {
		config.FilesOrigin = config.PublicURL
	}
	for _, origin := range []struct{ name, value string }{
		{"MONKEYAI_PUBLIC_URL", config.PublicURL},
		{"MONKEYAI_RUNTIME_FILES_ORIGIN", config.FilesOrigin},
	} {
		u, err := url.Parse(origin.value)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") {
			if err != nil {
				slog.Warn("操作失败", "module", "relay", "operation", "NewService", "error", err)
			}
			return nil, fmt.Errorf("%s 必须为不含账号、路径、查询参数或片段的 HTTP(S) origin", origin.name)
		}
	}
	for _, origin := range config.DesktopOrigins {
		if origin == "app://monkeyai" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery {
			if err != nil {
				slog.Warn("操作失败", "module", "relay", "operation", "NewService", "error", err)
			}
			return nil, errors.New("Desktop Origin 必须为完整 HTTP(S) origin")
		}
	}
	if err := validatePreviewTemplate(config.PreviewOriginTemplate, config.PublicURL, config.FilesOrigin); err != nil {
		return nil, err
	}
	key, err := resolveIdentity(&config)
	if err != nil {
		return nil, err
	}
	keys, err := loadVerificationKeys(config.VerificationKeysFile, key.Public().(ed25519.PublicKey))
	if err != nil {
		return nil, err
	}
	if config.MaxDevices <= 0 {
		config.MaxDevices = 1000
	}
	return &Service{pool: pool, identity: identities, devices: devices, logger: logger, config: config, key: key, verificationKeys: keys, kid: endpoint.KeyID(key.Public().(ed25519.PublicKey)), routes: make(map[target]*route), active: make(map[*websocket.Conn]struct{}), limiter: make(map[string]rateWindow)}, nil
}

func (s *Service) Register(router chi.Router) {
	s.RegisterTunnel(router)
	RegisterRevocation(router, s.identity, s.devices, func(_ context.Context, user, machine string, version int64) error {
		s.InvalidateDevice(user, machine, version)
		return nil
	})
}

func (s *Service) RegisterTunnel(router chi.Router) {
	router.HandleFunc("/preview/{machine}/{grant}/*", s.preview)
	router.With(s.identity.RequireAgent).Get("/api/v1/endpoint-bridge", s.bridge)
	router.With(s.identity.RequireAgent, identity.RequireScope("device:connect")).Post("/api/v1/endpoints/{machine}/connections", s.connections)
	router.HandleFunc("/api/v1/endpoints/{machine}/proxy/*", s.proxy)
	router.HandleFunc("/endpoints/{machine}/files/{grant}/*", s.file)
}

func (s *Service) allow(grant string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	window := s.limiter[grant]
	if now.Sub(window.start) >= time.Second {
		window = rateWindow{start: now}
	}
	if window.count >= 20 {
		return false
	}
	window.count++
	if len(s.limiter) >= 10000 {
		for id, bucket := range s.limiter {
			if now.Sub(bucket.start) > time.Minute {
				delete(s.limiter, id)
			}
		}
		if len(s.limiter) >= 10000 {
			return false
		}
	}
	s.limiter[grant] = window
	return true
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	worker := logging.NewWorker(s.logger, "relay", "cleanup_connections", "database")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := sqlc.New(s.pool).PurgeExpiredConnections(cleanup)
			if err == nil {
				err = s.identity.CleanupDeviceRequests(cleanup)
			}
			cancel()
			worker.Report(ctx, err)
			s.mu.Lock()
			for id, bucket := range s.limiter {
				if time.Since(bucket.start) > time.Minute {
					delete(s.limiter, id)
				}
			}
			s.mu.Unlock()
		}
	}
}

func (s *Service) DeviceAuthorizationKey() []byte {
	return deviceAuthorizationKey(s.key)
}

func deviceAuthorizationKey(key ed25519.PrivateKey) []byte {
	mac := hmac.New(sha256.New, key.Seed())
	mac.Write([]byte("monkeyai:device-authorization:v1"))
	return mac.Sum(nil)
}

func (s *Service) Metadata() map[string]any {
	return runtimeMetadata(s.config, s.verificationKeys)
}

func runtimeMetadata(config Config, keys []map[string]string) map[string]any {
	metadata := map[string]any{"server_id": config.ServerID, "bridge_url": strings.Replace(config.PublicURL, "http", "ws", 1) + "/api/v1/endpoint-bridge",
		"files_origin": config.FilesOrigin, "access_signing_keys": keys,
		"runtime_api": []int{1}, "tunnel_versions": []int{Version}, "features": map[string]bool{"device_binding": true, "desktop_managed": true, "runtime_relay": true, "terminal_ws": true}}
	metadata["time_policy"] = map[string]int64{"access_lease_ttl_ms": 60000, "access_lease_renew_ms": 20000, "max_auth_staleness_ms": 180000, "max_time_reference_age_ms": 120000, "max_time_uncertainty_ms": 5000, "max_grant_clock_skew_ms": 5000, "max_file_grant_ttl_ms": 300000}
	if config.PreviewOriginTemplate != "" {
		metadata["preview_origin_template"] = config.PreviewOriginTemplate
		metadata["features"].(map[string]bool)["artifact_preview"] = true
		metadata["preview_storage_policy"] = "opaque_no_storage"
	}
	return metadata
}

func fail(ctx context.Context, w http.ResponseWriter, err error) {
	w.Header().Set("Cache-Control", "no-store")
	var fault *resource.Error
	if errors.As(err, &fault) {
		if fault.Code == "device_offline" || fault.Code == "device_draining" {
			logging.Expected(ctx)
		}
		resource.Fail(ctx, w, fault)
		return
	}
	logging.Diagnostic(ctx, slog.Default(), slog.LevelError, "relay.authorization.failed", err)
	failure(ctx, w, http.StatusServiceUnavailable, "authorization_state_unavailable")
}

func failure(ctx context.Context, w http.ResponseWriter, status int, code string) {
	if code == "device_offline" || code == "device_draining" {
		logging.Expected(ctx)
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.Fail(ctx, w, &resource.Error{Status: status, Code: code, Message: map[string]string{
		"invalid_request": "请求参数无效", "invalid_scope": "申请权限无效", "permission_denied": "没有所需权限", "device_not_found": "设备不存在", "device_offline": "目标执行端离线",
		"device_draining": "执行服务正在停止", "device_process_conflict": "此设备已有活动执行进程", "device_registration_changed": "设备登记已变化",
		"device_revoked": "远程访问已撤销", "upgrade_required": "需要升级协议版本", "connection_expired": "连接授权已过期或撤销",
		"authorization_state_unavailable": "授权核验暂不可用", "relay_overloaded": "中转资源达到上限", "device_connection_limit": "设备连接数达到上限",
		"clock_sync_unavailable": "授时参考不可用", "not_found": "入口不存在", "terminal_limit_reached": "终端或数据流名额已满",
	}[code]})
}

func (s *Service) gate(key target) *sync.Mutex {
	hash := fnv.New64a()
	hash.Write([]byte(key.user + "/" + key.machine))
	return &s.gates[hash.Sum64()%uint64(len(s.gates))]
}

func (s *Service) current(key target) *route {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.routes[key]
	if r == nil || !r.ready || time.Since(r.seen) >= controlSilenceLimit || r.control == nil || r.control.IsClosed() {
		return nil
	}
	return r
}

func (s *Service) closeRoute(r *route, reason string) {
	if r == nil {
		return
	}
	s.mu.Lock()
	if r.closed {
		s.mu.Unlock()
		return
	}
	r.closed = true
	if s.routes[r.target] == r {
		delete(s.routes, r.target)
	}
	r.ready = false
	lastSeenAge := time.Since(r.seen)
	data, control := r.data, r.control
	accesses := make([]*access, 0, len(r.streams))
	for a := range r.streams {
		accesses = append(accesses, a)
	}
	s.mu.Unlock()
	logging.Event(context.Background(), s.logger, slog.LevelInfo, "relay.route.closed", "设备路由已关闭",
		"server_id", s.config.ServerID, "user_id", r.target.user, "machine_id", r.target.machine,
		"boot_id", r.hello.BootID, "lease_epoch", r.state.LeaseEpoch, "channel_kind", "control",
		"reason", reason, "last_seen_age_ms", lastSeenAge.Milliseconds())
	// 先记录本端撤销决定，再通知设备，避免对端随后的 EOF 掩盖关闭原因。
	streamReason := "stream_closed"
	if reason == "device_revoked" || reason == "grant_revoked" {
		s.pushControl(r, map[string]string{"type": "revocation", "signed": s.revocation(r, "", 0)})
		s.metrics.revoked.Add(int64(len(accesses)))
		streamReason = "authorization_revoked"
	}
	for _, a := range accesses {
		a.closeReason(streamReason)
	}
	if data != nil {
		if err := data.Close(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "closeRoute", "error", err)
		}
	}
	if control != nil {
		if err := control.Close(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "closeRoute", "error", err)
		}
	}
	if r.ws != nil {
		if err := r.ws.CloseNow(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "closeRoute", "error", err)
		}
	}
}

func (s *Service) InvalidateDevice(user, machine string, version int64) {
	key := target{user, machine}
	gate := s.gate(key)
	gate.Lock()
	defer gate.Unlock()
	s.mu.Lock()
	r := s.routes[key]
	if r != nil && r.state.GrantVersion > version {
		r = nil
	}
	s.mu.Unlock()
	s.closeRoute(r, "device_revoked")
}

func (s *Service) InvalidateGrant(id string) {
	s.mu.Lock()
	routes := make([]*route, 0)
	accesses := make([]*access, 0)
	for _, r := range s.routes {
		if r.principal.GrantID == id {
			routes = append(routes, r)
			continue // 整条路由的撤销已覆盖其中所有访问。
		}
		for a := range r.streams {
			if a.clientGrant == id {
				accesses = append(accesses, a)
			}
		}
	}
	s.mu.Unlock()
	for _, a := range accesses {
		s.metrics.revoked.Add(1)
		s.pushControlForAccess(a)
		a.closeReason("authorization_revoked")
	}
	for _, r := range routes {
		s.closeRoute(r, "grant_revoked")
	}
}

func (s *Service) Shutdown(ctx context.Context) error {
	s.draining.Store(true)
	s.mu.Lock()
	routes := make([]*route, 0, len(s.routes))
	for _, r := range s.routes {
		routes = append(routes, r)
	}
	connections := make([]*websocket.Conn, 0, len(s.active))
	for ws := range s.active {
		connections = append(connections, ws)
	}
	s.mu.Unlock()
	for _, r := range routes {
		s.closeRoute(r, "service_shutdown")
	}
	for _, ws := range connections {
		if err := ws.CloseNow(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "Shutdown", "error", err)
		}
	}
	finished := make(chan struct{})
	go func() { s.workers.Wait(); close(finished) }()
	select {
	case <-finished:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func muxConfig(channel string) *yamux.Config {
	cfg := yamux.DefaultConfig()
	cfg.EnableKeepAlive = false
	cfg.AcceptBacklog = 4
	cfg.StreamOpenTimeout = 10 * time.Second
	cfg.StreamCloseTimeout = 10 * time.Second
	cfg.ConnectionWriteTimeout = 10 * time.Second
	if channel == "control" {
		// Ping 也用写超时等待 Pong。开流 ACK 超时会关闭整条 yamux 会话。
		cfg.ConnectionWriteTimeout = controlSilenceLimit - controlProbeInterval
		cfg.StreamOpenTimeout = controlSilenceLimit
	}
	cfg.LogOutput = io.Discard
	return cfg
}

func RegisterRevocation(router chi.Router, ids *identity.Service, devices *endpoint.Execution, invalidate func(context.Context, string, string, int64) error) {
	router.With(ids.RequireAgent, identity.RequireScope("device:manage")).Delete("/api/v1/endpoints/{machine}", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		p, _ := identity.PrincipalFromContext(r.Context())
		machine := chi.URLParam(r, "machine")
		if !validUUID(machine) {
			failure(r.Context(), w, 400, "invalid_request")
			return
		}
		state, err := devices.Revoke(ctx, p, machine)
		if err != nil {
			fail(r.Context(), w, err)
			return
		}
		if err := invalidate(ctx, p.UserID, machine, state.GrantVersion); err != nil {
			fail(ctx, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func (s *Service) DisconnectRuntime(user, machine string) {
	s.mu.Lock()
	r := s.routes[target{user, machine}]
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(s.pool).RevokeTargetConnections(ctx, sqlc.RevokeTargetConnectionsParams{UserID: user, MachineID: machine}); err != nil {
		s.logger.ErrorContext(ctx, "撤销云环境连接票据失败", "error", err)
	}
	s.closeRoute(r, "runtime_disconnected")
}
