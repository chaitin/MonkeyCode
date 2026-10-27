package identity

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const RuntimeClientID = "monkeyai-runtime"
const DeviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

var runtimeScopes = []string{"device:bind", "device:publish", "session:report"}

type DeviceRegistry interface {
	VerifyDeviceRequest(context.Context, pgx.Tx, string, string, []byte) (bool, error)
}
type deviceWindow struct {
	start time.Time
	count int
}
type deviceAuthorization struct {
	serverID string
	key      []byte
	registry DeviceRegistry
	mu       sync.Mutex
	limits   map[string]deviceWindow
}

func (s *Service) WithDeviceAuthorization(serverID string, key []byte, registry DeviceRegistry) *Service {
	s.device = &deviceAuthorization{serverID: serverID, key: slices.Clone(key), registry: registry, limits: map[string]deviceWindow{}}
	return s
}
func (s *Service) deviceEnabled() bool {
	return s.device != nil && len(s.device.key) >= 32 && s.device.registry != nil
}
func (s *Service) deviceLimit(r *http.Request, kind string, limit int) bool {
	if !s.deviceEnabled() {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceLimit", "error", err)
		host = r.RemoteAddr
	}
	key := kind + ":" + tokenHash(host)
	s.device.mu.Lock()
	defer s.device.mu.Unlock()
	now := s.now()
	window := s.device.limits[key]
	if now.Sub(window.start) >= time.Minute {
		window = deviceWindow{start: now}
	}
	if window.count >= limit {
		return false
	}
	if len(s.device.limits) >= 10000 {
		for id, w := range s.device.limits {
			if now.Sub(w.start) > 2*time.Minute {
				delete(s.device.limits, id)
			}
		}
		if len(s.device.limits) >= 10000 {
			return false
		}
	}
	window.count++
	s.device.limits[key] = window
	return true
}
func (s *Service) userCodeHash(code string) string {
	mac := hmac.New(sha256.New, s.device.key)
	mac.Write([]byte("monkeyai:device-user-code:v1:" + code))
	return hex.EncodeToString(mac.Sum(nil))
}
func canonicalUserCode(code string) (string, bool) {
	code = strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(code), "-", ""), " ", ""))
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	if len(code) != 8 {
		return "", false
	}
	for _, c := range code {
		if !strings.ContainsRune(alphabet, c) {
			return "", false
		}
	}
	return code, true
}
func randomUserCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	for i := range value {
		value[i] = alphabet[int(value[i])%len(alphabet)]
	}
	return string(value), nil
}
func deviceText(value string, max int) bool {
	return len(value) <= max && strings.TrimSpace(value) != "" && utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}
func deviceUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && len(value) == 36 && id.String() == value && value[14] == '4' && strings.ContainsRune("89ab", rune(value[19]))
}

type DeviceResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int64  `json:"expires_in"`
	Interval                int64  `json:"interval"`
}

func (s *Service) deviceAuthorization(w http.ResponseWriter, r *http.Request) {
	if !s.deviceEnabled() {
		s.writeOAuthError(r.Context(), w, oauthError("unsupported_grant_type", "设备授权当前不可用"))
		return
	}
	if !s.deviceLimit(r, "request", 60) {
		w.Header().Set("Retry-After", "60")
		writeJSON(r.Context(), w, 429, protocolError{Code: "temporarily_unavailable", Description: "设备授权申请过于频繁"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if r.ParseForm() != nil {
		s.writeOAuthError(r.Context(), w, oauthError("invalid_request", "请求格式无效"))
		return
	}
	if r.PostForm.Get("client_id") != RuntimeClientID {
		s.writeOAuthError(r.Context(), w, oauthError("invalid_client", "仅独立 runtime 使用设备授权"))
		return
	}
	scope := r.PostForm.Get("scope")
	if scope == "" {
		scope = strings.Join(runtimeScopes, " ")
	}
	scopes, err := parseScopes(RuntimeClientID, scope)
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	machine, display, platform, arch := r.PostForm.Get("machine_id"), r.PostForm.Get("display_name"), r.PostForm.Get("platform"), r.PostForm.Get("arch")
	public, err := base64.RawURLEncoding.Strict().DecodeString(r.PostForm.Get("execution_public_key"))
	if err != nil || len(public) != ed25519.PublicKeySize || !deviceUUID(machine) || !deviceText(display, 128) || !deviceText(arch, 32) || !slices.Contains([]string{"macos", "windows", "linux"}, platform) {
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceAuthorization", "error", err)
		}
		s.writeOAuthError(r.Context(), w, oauthError("invalid_request", "设备信息或公钥无效"))
		return
	}
	deviceCode, err := randomToken(32)
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	userCode, err := randomUserCode()
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	fingerprint := sha256.Sum256(public)
	_, err = sqlc.New(s.db).CreateDeviceRequest(r.Context(), sqlc.CreateDeviceRequestParams{ClientID: RuntimeClientID, DeviceCodeHash: tokenHash(deviceCode), UserCodeHash: s.userCodeHash(userCode), MachineID: machine, ExecutionPublicKey: public, KeyID: base64.RawURLEncoding.EncodeToString(fingerprint[:]), DisplayName: display, Platform: platform, Arch: arch, RequestedScopes: scopes, ExpiresAt: s.now().Add(10 * time.Minute)})
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	formatted := userCode[:4] + "-" + userCode[4:]
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(r.Context(), w, 200, DeviceResponse{DeviceCode: deviceCode, UserCode: formatted, VerificationURI: s.publicURL + "/device", VerificationURIComplete: s.publicURL + "/device?user_code=" + url.QueryEscape(formatted), ExpiresIn: 600, Interval: 5})
}

func (s *Service) deviceRequest(w http.ResponseWriter, r *http.Request) {
	if !s.deviceEnabled() {
		writeError(r.Context(), w, 404, "request_not_found", "设备申请不可用")
		return
	}
	if !s.deviceLimit(r, "verify", 60) {
		writeError(r.Context(), w, 429, "rate_limited", "设备码查询过于频繁")
		return
	}
	var request sqlc.OauthDeviceRequest
	var err error
	id := chi.URLParam(r, "requestID")
	if id != "device" && deviceUUID(id) {
		request, err = sqlc.New(s.db).DeviceRequestByID(r.Context(), id)
	} else {
		code, valid := canonicalUserCode(r.URL.Query().Get("user_code"))
		if !valid {
			writeError(r.Context(), w, 404, "request_not_found", "设备码无效或已过期")
			return
		}
		request, err = sqlc.New(s.db).DeviceRequestByCode(r.Context(), s.userCodeHash(code))
	}
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !s.now().Before(request.ExpiresAt) {
		writeError(r.Context(), w, 404, "request_not_found", "设备码无效或已过期")
		return
	}
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceRequest", "error", err)
		writeError(r.Context(), w, 503, "authorization_state_unavailable", "设备申请暂不可用")
		return
	}
	connections, err := s.connections(r.Context())
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceRequest", "error", err)
		writeError(r.Context(), w, 503, "settings_unavailable", "登录方式暂不可用")
		return
	}
	user, authenticated := s.BrowserUser(r)
	requiresRestore, conflict := false, false
	if authenticated {
		tx, beginErr := s.db.BeginTx(r.Context(), pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if beginErr != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceRequest", "error", beginErr)
			writeError(r.Context(), w, 503, "authorization_state_unavailable", "设备状态暂不可用")
			return
		}
		requiresRestore, err = s.device.registry.VerifyDeviceRequest(r.Context(), tx, user.ID, request.MachineID, request.ExecutionPublicKey)
		if err := tx.Rollback(r.Context()); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "deviceRequest", "error", err)
		}
		if errors.Is(err, ErrDeviceBindingConflict) {
			conflict = true
		} else if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceRequest", "error", err)
			writeError(r.Context(), w, 503, "authorization_state_unavailable", "设备状态暂不可用")
			return
		}
	}
	if request.Status == "approved" || request.Status == "consumed" {
		if request.OwnerUserID == nil || !authenticated || *request.OwnerUserID != user.ID {
			writeError(r.Context(), w, 404, "request_not_found", "设备申请不存在或已处理")
			return
		}
	}
	writeJSON(r.Context(), w, 200, map[string]any{"requires_restore": requiresRestore, "registration_conflict": conflict, "purpose": "device", "request_id": request.ID, "client": Clients[RuntimeClientID], "authenticated": authenticated, "user": nullableUser(user, authenticated), "providers": publicConnections(connections), "machine_id": request.MachineID, "display_name": request.DisplayName, "platform": request.Platform, "arch": request.Arch, "key_fingerprint": request.KeyID, "scopes": request.RequestedScopes, "scope_descriptions": scopeNames, "expires_at": request.ExpiresAt, "status": request.Status, "csrf_token": consentToken(r, request.ID)})
}

type deviceDecision struct {
	RequestID      string    `json:"request_id"`
	Decision       string    `json:"decision"`
	Scopes         *[]string `json:"approved_scopes"`
	RestoreRevoked bool      `json:"restore_revoked"`
}

func (s *Service) deviceDecision(w http.ResponseWriter, r *http.Request) {
	if !s.deviceEnabled() {
		writeError(r.Context(), w, 404, "request_not_found", "设备授权不可用")
		return
	}
	var in deviceDecision
	if readDeviceJSON(w, r, &in) != nil || !deviceUUID(in.RequestID) || !slices.Contains([]string{"approve", "deny"}, in.Decision) {
		writeError(r.Context(), w, 400, "invalid_request", "设备授权决定无效")
		return
	}
	if err := verifyConsent(r, in.RequestID, s.publicURL); err != nil {
		writeError(r.Context(), w, 403, "consent_required", err.Error())
		return
	}
	user, _ := UserFromContext(r.Context())
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		writeError(r.Context(), w, 503, "authorization_state_unavailable", "授权状态暂不可用")
		return
	}
	defer func() {
		if err := tx.Rollback(context.WithoutCancel(r.Context())); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "deviceDecision", "error", err)
		}
	}()
	q := sqlc.New(tx)
	request, err := q.LockDeviceRequest(r.Context(), in.RequestID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(r.Context(), w, 404, "request_not_found", "设备申请不存在")
		return
	}
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		writeError(r.Context(), w, 503, "authorization_state_unavailable", "设备申请暂不可用")
		return
	}
	if !s.now().Before(request.ExpiresAt) {
		if err := q.ResolveDeviceRequest(r.Context(), sqlc.ResolveDeviceRequestParams{ID: request.ID, Status: "expired"}); err != nil {
			slog.Error("操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		}
		if err := tx.Commit(r.Context()); err != nil {
			slog.Error("操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		}
		writeError(r.Context(), w, 409, "device_request_resolved", "设备申请已过期")
		return
	}
	if request.Status != "pending" {
		writeError(r.Context(), w, 409, "device_request_resolved", "设备申请已经处理")
		return
	}
	if _, err = q.LockDeviceOwner(r.Context(), user.ID); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		writeError(r.Context(), w, 403, "permission_denied", "账号不可用于设备授权")
		return
	}
	status := "denied"
	scopes := []string{}
	if in.Decision == "approve" {
		if in.Scopes == nil {
			writeError(r.Context(), w, 400, "invalid_scope", "请明确批准权限")
			return
		}
		scopes, err = approvedScopes(request.RequestedScopes, *in.Scopes)
		if err != nil {
			writeError(r.Context(), w, 400, "invalid_scope", err.Error())
			return
		}
		revoked, checkErr := s.device.registry.VerifyDeviceRequest(r.Context(), tx, user.ID, request.MachineID, request.ExecutionPublicKey)
		if checkErr != nil {
			if errors.Is(checkErr, ErrDeviceBindingConflict) {
				writeError(r.Context(), w, 409, "device_registration_conflict", "设备公钥与已登记身份冲突")
			} else {
				writeError(r.Context(), w, 503, "authorization_state_unavailable", "设备登记暂不可用")
			}
			return
		}
		if revoked && !in.RestoreRevoked {
			writeError(r.Context(), w, 409, "device_revoked", "请明确批准恢复已撤销设备")
			return
		}
		status = "approved"
	}
	changed, err := q.DecideDeviceRequest(r.Context(), sqlc.DecideDeviceRequestParams{ID: request.ID, Status: status, OwnerUserID: new(user.ID), ApprovedScopes: scopes, RestoreRevoked: in.RestoreRevoked})
	if err != nil || changed != 1 {
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		}
		writeError(r.Context(), w, 409, "device_request_resolved", "设备申请已被其他操作处理")
		return
	}
	if err = audit.Write(r.Context(), tx, audit.Event{ActorID: user.ID, Action: "device." + status, Category: "security", TargetType: "endpoint", TargetID: request.MachineID, Params: map[string]any{"request_id": request.ID, "scopes": scopes, "restore_revoked": in.RestoreRevoked}}); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		writeError(r.Context(), w, 503, "authorization_state_unavailable", "无法保存授权决定")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "deviceDecision", "error", err)
		writeError(r.Context(), w, 503, "authorization_state_unavailable", "无法保存授权决定")
		return
	}
	writeJSON(r.Context(), w, 200, map[string]string{"status": status})
}

func (s *Service) ExchangeDeviceCode(ctx context.Context, clientID, code string) (Token, error) {
	if !s.deviceEnabled() || clientID != RuntimeClientID {
		return Token{}, oauthError("invalid_client", "设备授权客户端无效")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Token{}, err
	}
	defer func() {
		if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "ExchangeDeviceCode", "error", err)
		}
	}()
	q := sqlc.New(tx)
	request, err := q.LockDeviceCode(ctx, sqlc.LockDeviceCodeParams{DeviceCodeHash: tokenHash(code), ClientID: clientID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Token{}, oauthError("invalid_grant", "设备授权码无效")
	}
	if err != nil {
		return Token{}, err
	}
	finish := func(status, oauthCode, message string) (Token, error) {
		if status != "" {
			if err := q.ResolveDeviceRequest(ctx, sqlc.ResolveDeviceRequestParams{ID: request.ID, Status: status}); err != nil {
				return Token{}, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return Token{}, err
		}
		return Token{}, oauthError(oauthCode, message)
	}
	now := s.now()
	if !now.Before(request.ExpiresAt) {
		return finish("expired", "expired_token", "设备授权码已过期")
	}
	switch request.Status {
	case "denied":
		return finish("", "access_denied", "设备授权已被拒绝")
	case "consumed":
		return finish("", "invalid_grant", "设备授权码已消费")
	case "expired":
		return finish("", "expired_token", "设备授权码已过期")
	}
	interval := request.IntervalMs
	if now.Before(request.NextPollAt) {
		interval += 5000
		if err = q.SetDevicePoll(ctx, sqlc.SetDevicePollParams{ID: request.ID, IntervalMs: interval, NextPollAt: now.Add(time.Duration(interval) * time.Millisecond)}); err != nil {
			return Token{}, err
		}
		return finish("", "slow_down", "请降低设备授权轮询频率")
	}
	if err = q.SetDevicePoll(ctx, sqlc.SetDevicePollParams{ID: request.ID, IntervalMs: interval, NextPollAt: now.Add(time.Duration(interval) * time.Millisecond)}); err != nil {
		return Token{}, err
	}
	if request.Status == "pending" {
		return finish("", "authorization_pending", "等待用户确认设备授权")
	}
	if request.OwnerUserID == nil {
		return Token{}, oauthError("invalid_grant", "设备授权缺少账号")
	}
	if _, err = q.LockDeviceOwner(ctx, *request.OwnerUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return finish("denied", "access_denied", "账号已经不可用")
		}
		return Token{}, err
	}
	revoked, err := s.device.registry.VerifyDeviceRequest(ctx, tx, *request.OwnerUserID, request.MachineID, request.ExecutionPublicKey)
	if err != nil {
		if errors.Is(err, ErrDeviceBindingConflict) {
			return finish("denied", "access_denied", "设备公钥与已登记身份冲突")
		}
		return Token{}, err
	}
	if revoked && !request.RestoreRevoked {
		return finish("denied", "access_denied", "恢复设备未被明确批准")
	}
	access, err := randomToken(32)
	if err != nil {
		return Token{}, err
	}
	refresh, err := randomToken(48)
	if err != nil {
		return Token{}, err
	}
	grant, err := q.CreateRuntimeGrant(ctx, sqlc.CreateRuntimeGrantParams{UserID: *request.OwnerUserID, Scopes: request.ApprovedScopes, RequestedMachineID: new(request.MachineID), RequestedKeyID: new(request.KeyID), RestoreApproved: request.RestoreRevoked, ExpiresAt: now.Add(s.refreshTTL)})
	if err != nil {
		return Token{}, err
	}
	token := Token{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: int64(s.accessTTL.Seconds()), ExpiresAt: now.Add(s.accessTTL), GrantID: grant.ID, Scope: strings.Join(grant.Scopes, " "), ServerID: s.device.serverID, MachineID: request.MachineID}
	if _, err = q.CreateToken(ctx, sqlc.CreateTokenParams{UserID: grant.UserID, ClientID: RuntimeClientID, GrantID: grant.ID, AccessTokenHash: tokenHash(access), RefreshTokenHash: tokenHash(refresh), AccessExpiresAt: token.ExpiresAt, RefreshExpiresAt: grant.ExpiresAt}); err != nil {
		return Token{}, err
	}
	if err = q.ResolveDeviceRequest(ctx, sqlc.ResolveDeviceRequestParams{ID: request.ID, Status: "consumed"}); err != nil {
		return Token{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Token{}, err
	}
	return token, nil
}

func readDeviceJSON(w http.ResponseWriter, r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("设备请求含多余 JSON")
	}
	return nil
}

func (s *Service) CleanupDeviceRequests(ctx context.Context) error {
	if !s.deviceEnabled() {
		return nil
	}
	return sqlc.New(s.db).CleanupDeviceRequests(ctx)
}
