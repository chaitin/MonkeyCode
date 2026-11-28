// [INPUT]: 设备身份、签名握手、保留确认读取中断的 bridgeTransport 与对应通道的 yamux 配置。
// [OUTPUT]: 发布已验证的控制路由，按代次与授权附着数据通道，区分确认中断、消息超限和内容无效。
// [POS]: 设备隧道入口，与 lease 的存活探测共用进程接管窗口。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func (s *Service) bridge(w http.ResponseWriter, r *http.Request) {
	if s.draining.Load() {
		failure(r.Context(), w, 503, "device_draining")
		return
	}
	channel := r.URL.Query().Get("channel_kind")
	if (channel != "control" && channel != "data") || r.URL.Query().Get("tunnel_version") != "1" {
		failure(r.Context(), w, 409, "upgrade_required")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.config.PublicURL {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	p, _ := identity.PrincipalFromContext(r.Context())
	if !s.allow(p.GrantID) {
		w.Header().Set("Retry-After", "1")
		failure(r.Context(), w, 429, "relay_overloaded")
		return
	}
	if !p.IsRuntime() && !p.Has("device:bind") {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	r = r.WithContext(audit.WithRequest(r, audit.Actor{ID: p.UserID}))
	s.mu.Lock()
	full := s.draining.Load() || s.slots >= s.config.MaxDevices*2
	if !full {
		s.slots++
		s.workers.Add(1)
	}
	s.mu.Unlock()
	if full {
		failure(r.Context(), w, 429, "relay_overloaded")
		return
	}
	defer s.workers.Done()
	defer func() { s.mu.Lock(); s.slots--; s.mu.Unlock() }()
	var transport bridgeTransport
	ws, err := transport.accept(w, r)
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "bridge", "error", err)
		return
	}
	s.mu.Lock()
	if s.draining.Load() {
		s.mu.Unlock()
		if err := ws.CloseNow(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "bridge", "error", err)
		}
		return
	}
	s.active[ws] = struct{}{}
	s.mu.Unlock()
	defer func() {
		if err := ws.CloseNow(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "bridge", "error", err)
		}
		s.mu.Lock()
		delete(s.active, ws)
		s.mu.Unlock()
		logging.Event(r.Context(), s.logger, slog.LevelDebug, "relay.bridge.closed", "设备通道已关闭", "channel_kind", channel)
	}()
	ws.SetReadLimit(maxControlMessage)
	initial, initialCancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer initialCancel()
	var hello Hello
	if err := readWS(initial, ws, &hello); err != nil {
		s.wsError(initial, ws, err)
		return
	}
	public, err := validateHello(hello, channel, Version)
	if err != nil {
		s.wsError(initial, ws, err)
		return
	}
	key := target{p.UserID, hello.MachineID}
	logging.Bind(r.Context(), slog.String("server_id", s.config.ServerID), slog.String("user_id", p.UserID), slog.String("machine_id", hello.MachineID), slog.String("boot_id", hello.BootID), slog.String("channel_kind", channel))
	state, err := s.devices.State(initial, p.UserID, hello.MachineID)
	var fault *resource.Error
	if err != nil && !(errors.As(err, &fault) && fault.Status == 404 && channel == "control") {
		s.wsError(initial, ws, err)
		return
	}
	if channel == "data" && !bytes.Equal(public, state.PublicKey) {
		s.wsError(initial, ws, &resource.Error{Status: 403, Code: "permission_denied", Message: "设备公钥不匹配"})
		return
	}
	initialCancel()
	handshake, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	nonce, err := randomSecret()
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "bridge", "error", err)
		return
	}
	challenge := Challenge{Type: "challenge", ServerID: s.config.ServerID, OwnerUserID: p.UserID, ChallengeID: uuid.New().String(), Nonce: nonce, TTLMS: 60000, ServerTime: time.Now().UTC(), GrantID: p.GrantID, RegistrationVersion: state.RegistrationVersion}
	if writeWS(handshake, ws, challenge) != nil {
		return
	}
	var proof Proof
	if err := readWS(handshake, ws, &proof); err != nil || proof.Type != "proof" || proof.ChallengeID != challenge.ChallengeID {
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "bridge", "error", err)
		}
		s.wsError(handshake, ws, errProtocol)
		return
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(proof.Signature)
	message, encodeErr := ProofBytes(hello, challenge)
	if encodeErr != nil {
		s.wsError(handshake, ws, encodeErr)
		return
	}
	if err != nil || len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, message, signature) {
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "bridge", "error", err)
		}
		s.wsError(handshake, ws, &resource.Error{Status: 403, Code: "invalid_device_proof", Message: "设备证明无效"})
		return
	}
	if err := s.verifyBridgeGrant(handshake, p); err != nil {
		s.wsError(handshake, ws, err)
		return
	}
	gate := s.gate(key)
	var old, current *route
	if channel == "data" {
		logging.Bind(handshake, slog.Int64("lease_epoch", hello.LeaseEpoch))
		old, err = s.dataRoute(handshake, key, p, hello, state)
		if err != nil {
			if handshake.Err() == nil {
				s.wsError(handshake, ws, err)
			}
			return
		}
		state = old.state
	} else {
		gate.Lock()
		s.mu.Lock()
		old = s.routes[key]
		conflict := hello.Intent == "publish" && old != nil && time.Since(old.seen) < controlSilenceLimit && old.hello.BootID != hello.BootID
		s.mu.Unlock()
		if conflict {
			gate.Unlock()
			s.wsError(handshake, ws, &resource.Error{Status: 409, Code: "device_process_conflict", Message: "设备已有活动执行进程"})
			return
		}
		state, err = s.devices.Enroll(handshake, p, endpoint.Enrollment{MachineID: hello.MachineID, PublicKey: public, DisplayName: hello.DisplayName, Platform: hello.Platform, Arch: hello.Arch,
			Intent: hello.Intent, DeploymentMode: hello.DeploymentMode, RestoreRevoked: hello.RestoreRevoked, Protocols: hello.Protocols, RuntimeVersion: hello.RuntimeVersion, EngineVersion: hello.EngineVersion}, challenge.RegistrationVersion)
		if err != nil {
			gate.Unlock()
			s.wsError(handshake, ws, err)
			return
		}
		logging.Event(r.Context(), s.logger, slog.LevelInfo, "relay.bridge.proved", "设备证明已提交", "module", "relay", "operation", "bridge", "server_id", s.config.ServerID, "user_id", p.UserID, "machine_id", hello.MachineID, "boot_id", hello.BootID, "intent", hello.Intent, "registration_version", state.RegistrationVersion, "grant_version", state.GrantVersion, "lease_epoch", state.LeaseEpoch)
		if hello.Intent == "publish" {
			if p.IsRuntime() {
				// 首次握手开始时授权尚未绑定，路由使用登记事务确认的身份。
				p.MachineID, p.KeyID = state.MachineID, state.KeyID
			}
			current = &route{publishDone: make(chan struct{}), runtimeStatus: "online", engineHealth: "unknown", controlQueue: make(chan any, 16), target: key, principal: p, hello: hello, state: state, ws: ws, seen: time.Now(), slotsControl: make(chan struct{}, 64), opensControl: make(chan struct{}, 64), streams: make(map[*access]struct{}), connectionVersions: make(map[string]connectionVersion)}
			s.mu.Lock()
			s.routes[key] = current
			s.mu.Unlock()
		}
		gate.Unlock()
	}
	closeReason := "control_handshake_incomplete"
	if current != nil {
		s.closeRoute(old, "epoch_replaced")
		defer func() { s.closeRoute(current, closeReason) }()
	}
	identityOnly := channel == "control" && hello.Intent == "bind_identity"
	ready := Ready{Type: "ready", ServerID: s.config.ServerID, MachineID: hello.MachineID, RegistrationVersion: state.RegistrationVersion, GrantVersion: state.GrantVersion, Bound: true}
	if !identityOnly {
		ready.LeaseEpoch = state.LeaseEpoch
		ready.PublicAddresses = map[string]string{"http_base": s.config.PublicURL + "/api/v1/endpoints/" + hello.MachineID + "/proxy/", "files_base": s.config.FilesOrigin + "/endpoints/" + hello.MachineID + "/files/"}
	}
	if writeWS(handshake, ws, ready) != nil {
		return
	}
	var ack ReadyAck
	readErr := transport.readAck(handshake, ws, &ack)
	switch {
	case errors.Is(readErr, websocket.ErrMessageTooBig):
		// WebSocket 已发送 1009 关闭帧。
		logging.Event(handshake, s.logger, slog.LevelWarn, "relay.bridge.rejected", "设备确认消息超限", "reason", "message_too_big", "phase", "ready_ack")
		return
	case readErr != nil && !errors.Is(readErr, errProtocol):
		logging.Event(handshake, s.logger, slog.LevelDebug, "relay.bridge.interrupted", "读取设备确认时连接中断", "phase", "ready_ack", "error", readErr)
		return
	}
	if readErr != nil || ack.Type != "ready_ack" || ack.RegistrationVersion != ready.RegistrationVersion || !identityOnly && ack.LeaseEpoch != ready.LeaseEpoch {
		s.wsError(handshake, ws, errProtocol)
		return
	}
	if identityOnly {
		return
	}
	// NetConn 使用整个连接生命周期，握手超时不传入二进制阶段。
	conn := websocket.NetConn(r.Context(), ws, websocket.MessageBinary)
	ws.SetReadLimit(1 << 20)
	mux, err := yamux.Server(conn, muxConfig(channel))
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "bridge", "error", err)
		return
	}
	defer func() {
		if err := mux.Close(); err != nil && !closedConnection(err) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "bridge", "error", err)
		}
	}()
	if channel == "data" {
		gate.Lock()
		s.mu.Lock()
		if reason := s.dataRouteChange(old); reason != "" {
			s.mu.Unlock()
			gate.Unlock()
			logging.Event(r.Context(), s.logger, slog.LevelWarn, "relay.bridge.rejected", "数据确认时控制路由已失效", "reason", reason, "phase", "ready_ack")
			return
		}
		previous := old.data
		old.data = mux
		old.dataBudget = newDataBudget(&s.metrics)
		old.dataBudget.logger = s.logger.With("module", "relay", "server_id", s.config.ServerID, "user_id", p.UserID,
			"machine_id", hello.MachineID, "boot_id", hello.BootID, "lease_epoch", state.LeaseEpoch)
		s.mu.Unlock()
		gate.Unlock()
		logging.Event(r.Context(), s.logger, slog.LevelInfo, "relay.bridge.ready", "设备数据通道已就绪")
		if previous != nil {
			if err := previous.Close(); err != nil && !closedConnection(err) {
				slog.Error("关闭资源失败", "module", "relay", "operation", "bridge", "error", err)
			}
		}
		defer func() {
			s.mu.Lock()
			if old.data == mux {
				old.data = nil
			}
			s.mu.Unlock()
		}()
		// 数据通道只接受控制面打开的业务流，拒绝执行端反向拨号。
		if incoming, err := mux.AcceptStream(); err == nil {
			if err := incoming.Close(); err != nil && !closedConnection(err) {
				slog.Error("关闭资源失败", "module", "relay", "operation", "bridge", "error", err)
			}
		}
		return
	}
	s.mu.Lock()
	if current.closed {
		s.mu.Unlock()
		return
	}
	current.control = mux
	s.mu.Unlock()
	closeReason = "control_transport_closed"
	s.control(r.Context(), current)
}

func (s *Service) verifyBridgeGrant(ctx context.Context, p identity.Principal) error {
	valid, err := s.identity.VerifyGrant(ctx, p)
	if err != nil {
		return err
	}
	if !valid {
		logging.Bind(ctx, slog.String("reason", "grant_invalid"))
		return &resource.Error{Status: 403, Code: "permission_denied", Message: "设备授权已失效"}
	}
	return nil
}

// 调用方持有 s.mu。从等待发布到安装数据通道，握手只接受原控制路由。
func (s *Service) dataRouteChange(expected *route) string {
	current := s.routes[expected.target]
	switch {
	case current == nil:
		return "control_missing"
	case current != expected:
		return "route_replaced"
	case !expected.ready || expected.control == nil || expected.control.IsClosed():
		return "control_closed"
	default:
		return ""
	}
}

func (s *Service) dataRoute(ctx context.Context, key target, p identity.Principal, hello Hello, state endpoint.ExecutionState) (*route, error) {
	r, pending, reason := s.matchDataRoute(key, p.GrantID, hello, state)
	if pending != nil {
		// 在锁外等待本次发布。超时沿用原错误码，就绪或关闭后重新核验。
		logging.Event(ctx, s.logger, slog.LevelDebug, "relay.bridge.waiting", "数据通道等待控制就绪", "reason", reason)
		wait, stop := context.WithTimeout(ctx, time.Second)
		defer stop()
		select {
		case <-wait.Done():
			if err := ctx.Err(); err != nil {
				return nil, err
			}
		case <-pending:
			s.mu.Lock()
			reason = s.dataRouteChange(r)
			s.mu.Unlock()
			if reason != "" {
				break
			}
			fresh, err := s.devices.State(ctx, key.user, key.machine)
			if err != nil {
				return nil, err
			}
			if err := s.verifyBridgeGrant(ctx, p); err != nil {
				return nil, err
			}
			r, _, reason = s.matchDataRoute(key, p.GrantID, hello, fresh)
			if reason == "" && (fresh.RegistrationVersion != state.RegistrationVersion || !bytes.Equal(fresh.PublicKey, state.PublicKey)) {
				reason = "registration_changed"
			}
		}
	}
	if reason != "" {
		logging.Bind(ctx, slog.String("reason", reason))
		return nil, &resource.Error{Status: 409, Code: "device_registration_changed", Message: "数据通道不能附着当前执行连接"}
	}
	return r, nil
}

// 只有身份、授权和代次都匹配且控制发布未完成时才返回等待通知。
func (s *Service) matchDataRoute(key target, grantID string, hello Hello, state endpoint.ExecutionState) (*route, <-chan struct{}, string) {
	gate := s.gate(key)
	gate.Lock()
	defer gate.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.routes[key]
	switch {
	case state.RemoteAccessState != "enabled":
		return nil, nil, "remote_access_disabled"
	case state.ActiveGrantID != grantID:
		return nil, nil, "grant_mismatch"
	case r == nil || r.closed:
		return nil, nil, "control_missing"
	case state.LeaseEpoch != hello.LeaseEpoch || r.state.LeaseEpoch != hello.LeaseEpoch:
		return nil, nil, "lease_epoch_mismatch"
	case r.hello.BootID != hello.BootID:
		return nil, nil, "boot_id_mismatch"
	case r.principal.GrantID != grantID:
		return nil, nil, "grant_mismatch"
	case r.state.GrantVersion != state.GrantVersion:
		return nil, nil, "grant_version_mismatch"
	case !r.ready:
		return r, r.publishDone, "control_not_ready"
	case r.control == nil || r.control.IsClosed():
		return nil, nil, "control_closed"
	default:
		return r, nil, ""
	}
}

func readWS(ctx context.Context, ws *websocket.Conn, out any) error {
	kind, data, err := ws.Read(ctx)
	if err != nil {
		return err
	}
	if kind != websocket.MessageText {
		return errProtocol
	}
	return decodeMessage(data, out)
}

func writeWS(ctx context.Context, ws *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ws.Write(ctx, websocket.MessageText, data)
}

func (s *Service) wsError(ctx context.Context, ws *websocket.Conn, err error) {
	code := "authorization_state_unavailable"
	var fault *resource.Error
	if errors.As(err, &fault) {
		code = fault.Code
	} else if errors.Is(err, errProtocol) {
		code = "invalid_tunnel_message"
	}
	logging.MessageError(ctx, code, "")
	if err := writeWS(ctx, ws, map[string]any{"type": "error", "code": code}); err != nil {
		slog.Error("操作失败", "module", "relay", "operation", "wsError", "error", err)
	}
	logCode := "internal_error"
	switch code {
	case "authorization_state_unavailable", "invalid_tunnel_message", "permission_denied", "invalid_device_proof", "device_process_conflict", "device_registration_changed", "device_revoked", "device_not_found":
		logCode = code
	}
	level := slog.LevelWarn
	if fault != nil && fault.Status < 500 || ctx.Err() != nil {
		level = slog.LevelDebug
	}
	logging.Event(ctx, s.logger, level, "relay.bridge.rejected", "设备握手失败", "module", "relay", "operation", "handshake", "error_code", logCode, "error", err)
}
