package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func (s *Service) bridge(w http.ResponseWriter, r *http.Request) {
	if s.draining.Load() {
		failure(w, 503, "device_draining")
		return
	}
	channel := r.URL.Query().Get("channel_kind")
	if (channel != "control" && channel != "data") || r.URL.Query().Get("tunnel_version") != "1" {
		failure(w, 409, "upgrade_required")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.config.PublicURL {
		failure(w, 403, "permission_denied")
		return
	}
	p, _ := identity.PrincipalFromContext(r.Context())
	if !s.allow(p.GrantID) {
		w.Header().Set("Retry-After", "1")
		failure(w, 429, "relay_overloaded")
		return
	}
	if !p.Has("device:bind") {
		failure(w, 403, "permission_denied")
		return
	}
	s.mu.Lock()
	full := s.draining.Load() || s.slots >= s.config.MaxDevices*2
	if !full {
		s.slots++
		s.workers.Add(1)
	}
	s.mu.Unlock()
	if full {
		failure(w, 429, "relay_overloaded")
		return
	}
	defer s.workers.Done()
	defer func() { s.mu.Lock(); s.slots--; s.mu.Unlock() }()
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	s.mu.Lock()
	if s.draining.Load() {
		s.mu.Unlock()
		ws.CloseNow()
		return
	}
	s.active[ws] = struct{}{}
	s.mu.Unlock()
	defer func() { ws.CloseNow(); s.mu.Lock(); delete(s.active, ws); s.mu.Unlock() }()
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
		return
	}
	challenge := Challenge{Type: "challenge", ServerID: s.config.ServerID, OwnerUserID: p.UserID, ChallengeID: uuid.New().String(), Nonce: nonce, TTLMS: 60000, ServerTime: time.Now().UTC(), GrantID: p.GrantID, RegistrationVersion: state.RegistrationVersion}
	if writeWS(handshake, ws, challenge) != nil {
		return
	}
	var proof Proof
	if err := readWS(handshake, ws, &proof); err != nil || proof.Type != "proof" || proof.ChallengeID != challenge.ChallengeID {
		s.wsError(handshake, ws, errProtocol)
		return
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(proof.Signature)
	message, _ := ProofBytes(hello, challenge)
	if err != nil || len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, message, signature) {
		s.wsError(handshake, ws, &resource.Error{Status: 403, Code: "invalid_device_proof", Message: "设备证明无效"})
		return
	}
	valid, err := s.identity.VerifyGrant(handshake, p)
	if err != nil {
		s.wsError(handshake, ws, err)
		return
	}
	if !valid {
		s.wsError(handshake, ws, &resource.Error{Status: 403, Code: "permission_denied", Message: "设备授权已失效"})
		return
	}
	gate := s.gate(key)
	gate.Lock()
	s.mu.Lock()
	old := s.routes[key]
	conflict := channel == "control" && hello.Intent == "publish" && old != nil && time.Since(old.seen) < 45*time.Second && old.hello.BootID != hello.BootID
	s.mu.Unlock()
	if conflict {
		gate.Unlock()
		s.wsError(handshake, ws, &resource.Error{Status: 409, Code: "device_process_conflict", Message: "设备已有活动执行进程"})
		return
	}
	if channel == "data" {
		s.mu.Lock()
		attached := old != nil && state.RemoteAccessState == "enabled" && state.ActiveGrantID == p.GrantID && state.GrantVersion == old.state.GrantVersion && state.LeaseEpoch == hello.LeaseEpoch && old.hello.BootID == hello.BootID && old.state.LeaseEpoch == hello.LeaseEpoch && old.principal.GrantID == p.GrantID && old.ready
		s.mu.Unlock()
		if !attached {
			s.wsError(handshake, ws, &resource.Error{Status: 409, Code: "device_registration_changed", Message: "数据通道不能附着当前执行连接"})
			gate.Unlock()
			return
		}
		state = old.state
	} else {
		state, err = s.devices.Enroll(handshake, p, endpoint.Enrollment{MachineID: hello.MachineID, PublicKey: public, DisplayName: hello.DisplayName, Platform: hello.Platform, Arch: hello.Arch,
			Intent: hello.Intent, DeploymentMode: hello.DeploymentMode, RestoreRevoked: hello.RestoreRevoked, Protocols: hello.Protocols, RuntimeVersion: hello.RuntimeVersion, EngineVersion: hello.EngineVersion}, challenge.RegistrationVersion)
		if err != nil {
			gate.Unlock()
			s.wsError(handshake, ws, err)
			return
		}
	}
	if channel == "control" {
		s.logger.Info("设备证明已提交", "server_id", s.config.ServerID, "user_id", p.UserID, "machine_id", hello.MachineID, "boot_id", hello.BootID, "intent", hello.Intent, "registration_version", state.RegistrationVersion, "grant_version", state.GrantVersion, "lease_epoch", state.LeaseEpoch)
	}
	var current *route
	if channel == "control" && hello.Intent == "publish" {
		current = &route{runtimeStatus: "online", engineHealth: "unknown", controlQueue: make(chan any, 16), target: key, principal: p, hello: hello, state: state, ws: ws, seen: time.Now(), slotsControl: make(chan struct{}, 64), slotsData: make(chan struct{}, 16), streams: make(map[*access]struct{}), connectionVersions: make(map[string]connectionVersion)}
		s.mu.Lock()
		s.routes[key] = current
		s.mu.Unlock()
	}
	gate.Unlock()
	if current != nil {
		s.closeRoute(old)
		defer s.closeRoute(current)
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
	if err := readWS(handshake, ws, &ack); err != nil || ack.Type != "ready_ack" || ack.RegistrationVersion != ready.RegistrationVersion || !identityOnly && ack.LeaseEpoch != ready.LeaseEpoch {
		s.wsError(handshake, ws, errProtocol)
		return
	}
	if identityOnly {
		return
	}
	// NetConn 使用整个连接生命周期，握手超时不传入二进制阶段。
	conn := websocket.NetConn(r.Context(), ws, websocket.MessageBinary)
	ws.SetReadLimit(1 << 20)
	mux, err := yamux.Server(conn, muxConfig())
	if err != nil {
		return
	}
	defer mux.Close()
	if channel == "data" {
		gate.Lock()
		s.mu.Lock()
		if s.routes[key] != old || !old.ready {
			s.mu.Unlock()
			gate.Unlock()
			return
		}
		previous := old.data
		old.data = mux
		s.mu.Unlock()
		gate.Unlock()
		if previous != nil {
			previous.Close()
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
			incoming.Close()
		}
		return
	}
	s.mu.Lock()
	current.control = mux
	s.mu.Unlock()
	s.control(r.Context(), current)
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
	code, message := "authorization_state_unavailable", "授权核验暂不可用"
	var fault *resource.Error
	if errors.As(err, &fault) {
		code, message = fault.Code, fault.Message
	} else if errors.Is(err, errProtocol) {
		code, message = "invalid_tunnel_message", "隧道消息无效"
	}
	_ = writeWS(ctx, ws, map[string]any{"type": "error", "code": code})
	s.logger.Warn("设备握手失败", "code", code, "reason", message)
}
