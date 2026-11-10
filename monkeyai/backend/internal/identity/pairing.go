package identity

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	PairingGrantType = "urn:monkeyai:params:oauth:grant-type:pairing_code"
	PairingTTL       = 60 * time.Second
	PairingMaxTTL    = 180 * time.Second
	PairingMaxFailed = 5
)

var mobilePairingScopes = []string{
	"device:connect", "files:read", "files:write", "resources:manage", "session:control", "session:read",
}

type PairingResponse struct {
	ID      string `json:"pairing_id"`
	Secret  string `json:"secret"`
	Payload string `json:"qr_payload"`
	Expires int64  `json:"expires_in"`
}

type pairingJoin struct {
	Secret    string `json:"secret"`
	Challenge string `json:"code_challenge"`
	Method    string `json:"code_challenge_method"`
	MachineID string `json:"machine_id"`
	Name      string `json:"display_name"`
	Platform  string `json:"platform"`
	OSVersion string `json:"os_version"`
	Arch      string `json:"arch"`
}

type pairingJoined struct {
	UserCode   string `json:"user_code"`
	DeviceCode string `json:"device_code"`
	Expires    int64  `json:"expires_in"`
	Interval   int64  `json:"interval"`
}

func (s *Service) pairingPayload(id, secret string) string {
	query := url.Values{"v": {"1"}, "server": {s.publicURL}, "id": {id}, "secret": {secret}}
	return "monkeyai-mobile://pair/scan?" + query.Encode()
}

func (s *Service) pairingAvailable(w http.ResponseWriter, r *http.Request) bool {
	if !s.deviceEnabled() {
		writeError(r.Context(), w, 404, "pairing_unavailable", "手机配对当前不可用")
		return false
	}
	return true
}

func pairingNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(r.Context(), w, 404, "pairing_not_found", "配对不存在或已过期")
}

func pairingID(r *http.Request) (string, bool) {
	value := chi.URLParam(r, "pairingID")
	id, err := uuid.Parse(value)
	return value, err == nil && id.String() == value
}

// 入口鉴权可能先于改密完成，持有用户锁后重新检查凭据。
func pairingCredential(ctx context.Context, q *sqlc.Queries) error {
	credential, ok := CredentialFromContext(ctx)
	if !ok {
		return pgx.ErrNoRows
	}
	row, err := q.GetAccessCredential(ctx, credential.Reference)
	if err == nil && (row.UserID != credential.UserID || row.Audience != Audience || !slices.Contains(row.Scopes, "device:manage")) {
		return pgx.ErrNoRows
	}
	return err
}

func (s *Service) createPairing(w http.ResponseWriter, r *http.Request) {
	if !s.pairingAvailable(w, r) {
		return
	}
	if !s.deviceLimit(r, "pairing-create", 60) {
		w.Header().Set("Retry-After", "60")
		writeError(r.Context(), w, 429, "rate_limited", "创建配对过于频繁")
		return
	}
	var in map[string]json.RawMessage
	if readDeviceJSON(w, r, &in) != nil || in == nil || len(in) != 0 {
		writeError(r.Context(), w, 400, "invalid_request", "请求体必须为空 JSON 对象")
		return
	}
	secret, err := randomToken(32)
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	defer rollbackProfile(r.Context(), tx)
	q := sqlc.New(tx)
	user, _ := UserFromContext(r.Context())
	if _, err = q.LockProfileCredentials(r.Context(), user.ID); err == nil {
		err = pairingCredential(r.Context(), q)
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	now := s.now()
	request, err := q.CreatePairing(r.Context(), sqlc.CreatePairingParams{
		CreatorUserID: user.ID, SecretHash: tokenHash(secret), CreatedAt: now, ExpiresAt: now.Add(PairingTTL),
	})
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	writeJSON(r.Context(), w, 200, PairingResponse{ID: request.ID, Secret: secret, Payload: s.pairingPayload(request.ID, secret), Expires: int64(PairingTTL.Seconds())})
}

func (s *Service) joinPairing(w http.ResponseWriter, r *http.Request) {
	if !s.pairingAvailable(w, r) {
		return
	}
	if !s.deviceLimit(r, "pairing-join", 60) {
		w.Header().Set("Retry-After", "60")
		writeError(r.Context(), w, 429, "rate_limited", "加入配对过于频繁")
		return
	}
	id, valid := pairingID(r)
	if !valid {
		pairingNotFound(w, r)
		return
	}
	var in pairingJoin
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if readDeviceJSON(w, r, &in) != nil || !validChallenge(in.Challenge) || in.Method != "S256" ||
		!deviceUUID(in.MachineID) || !deviceText(in.Name, 128) || !deviceText(in.OSVersion, 64) || !deviceText(in.Arch, 32) ||
		!slices.Contains([]string{"android", "ios", "harmonyos"}, in.Platform) {
		writeError(r.Context(), w, 400, "invalid_request", "配对设备信息或 PKCE 无效")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	defer rollbackProfile(r.Context(), tx)
	q := sqlc.New(tx)
	request, err := q.LockPairing(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && subtle.ConstantTimeCompare([]byte(tokenHash(in.Secret)), []byte(request.SecretHash)) != 1 {
		pairingNotFound(w, r)
		return
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	now := s.now()
	if !now.Before(request.ExpiresAt) || request.Status == "expired" {
		pairingNotFound(w, r)
		return
	}
	if request.Status != "pending" {
		writeError(r.Context(), w, 409, "pairing_already_joined", "配对已被使用")
		return
	}
	code, err := randomToken(32)
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	userCode, err := randomUserCode()
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	expires := now.Add(PairingTTL)
	if maximum := request.CreatedAt.Add(PairingMaxTTL); expires.After(maximum) {
		expires = maximum
	}
	err = q.JoinPairing(r.Context(), sqlc.JoinPairingParams{
		ID: id, DeviceCodeHash: new(tokenHash(code)), UserCodeHash: new(s.userCodeHash(userCode)),
		CodeChallenge: new(in.Challenge), MachineID: new(in.MachineID), DisplayName: new(in.Name),
		Platform: new(in.Platform), OsVersion: new(in.OSVersion), Arch: new(in.Arch), ExpiresAt: expires,
	})
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	writeJSON(r.Context(), w, 200, pairingJoined{UserCode: userCode[:4] + "-" + userCode[4:], DeviceCode: code, Expires: int64(expires.Sub(now).Seconds()), Interval: 5})
}

func (s *Service) pairingStatus(w http.ResponseWriter, r *http.Request) {
	if !s.pairingAvailable(w, r) {
		return
	}
	id, valid := pairingID(r)
	if !valid {
		pairingNotFound(w, r)
		return
	}
	user, _ := UserFromContext(r.Context())
	request, err := sqlc.New(s.db).PairingByID(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && request.CreatorUserID != user.ID {
		pairingNotFound(w, r)
		return
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	status := request.Status
	if !s.now().Before(request.ExpiresAt) && slices.Contains([]string{"pending", "joined", "approved"}, status) {
		status = "expired"
	}
	out := map[string]any{"pairing_id": id, "status": status, "expires_at": request.ExpiresAt}
	if status != "pending" && request.DisplayName != nil {
		out["device"] = map[string]any{"display_name": request.DisplayName, "platform": request.Platform, "os_version": request.OsVersion}
	}
	writeJSON(r.Context(), w, 200, out)
}

func (s *Service) approvePairing(w http.ResponseWriter, r *http.Request) {
	if !s.pairingAvailable(w, r) {
		return
	}
	id, valid := pairingID(r)
	if !valid {
		pairingNotFound(w, r)
		return
	}
	var in struct {
		UserCode string `json:"user_code"`
	}
	if readDeviceJSON(w, r, &in) != nil {
		writeError(r.Context(), w, 400, "invalid_request", "配对码请求格式无效")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	defer rollbackProfile(r.Context(), tx)
	q := sqlc.New(tx)
	user, _ := UserFromContext(r.Context())
	request, err := q.LockPairing(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && request.CreatorUserID != user.ID {
		pairingNotFound(w, r)
		return
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	finish := func(status string, httpStatus int, code, message string) {
		if status != "" {
			err = q.ResolvePairing(r.Context(), sqlc.ResolvePairingParams{ID: id, Status: status})
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			profileFailure(r.Context(), w, err)
		} else if code != "" {
			writeError(r.Context(), w, httpStatus, code, message)
		} else {
			writeJSON(r.Context(), w, 200, map[string]string{"status": status})
		}
	}
	if !s.now().Before(request.ExpiresAt) || request.Status == "expired" {
		finish("expired", 409, "pairing_expired", "配对已过期")
		return
	}
	if request.Status != "joined" {
		writeError(r.Context(), w, 409, "pairing_resolved", "配对已处理或尚未加入")
		return
	}
	if _, err = q.LockProfileCredentials(r.Context(), user.ID); err == nil {
		err = pairingCredential(r.Context(), q)
	}
	if err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	code, valid := canonicalUserCode(in.UserCode)
	if !valid || request.UserCodeHash == nil || subtle.ConstantTimeCompare([]byte(s.userCodeHash(code)), []byte(*request.UserCodeHash)) != 1 {
		err = q.FailPairingCode(r.Context(), id)
		finish("", 400, "invalid_user_code", "配对码不正确")
		return
	}
	if err = audit.Write(r.Context(), tx, audit.Event{ActorID: user.ID, Action: "pairing.approved", Category: "security", TargetType: "pairing", TargetID: id,
		Params: map[string]any{"pairing_id": id, "platform": request.Platform, "display_name": request.DisplayName}}); err != nil {
		profileFailure(r.Context(), w, err)
		return
	}
	finish("approved", 200, "", "")
}

func (s *Service) ExchangePairingCode(ctx context.Context, clientID, deviceCode, verifier string) (Token, error) {
	if !s.deviceEnabled() || clientID != "monkeyai-mobile" {
		return Token{}, oauthError("invalid_client", "手机配对客户端无效")
	}
	if !verifierPattern.MatchString(verifier) {
		return Token{}, oauthError("invalid_grant", "code_verifier 无效")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Token{}, err
	}
	defer rollbackProfile(ctx, tx)
	q := sqlc.New(tx)
	request, err := q.PairingByDeviceCode(ctx, new(tokenHash(deviceCode)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Token{}, oauthError("invalid_grant", "配对授权码无效")
	}
	if err != nil {
		return Token{}, err
	}
	if _, err = q.LockProfileCredentials(ctx, request.CreatorUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Token{}, oauthError("invalid_grant", "账号不可用于配对")
		}
		return Token{}, err
	}
	request, err = q.LockPairingNowait(ctx, request.ID)
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "55P03" {
		return Token{}, oauthError("authorization_pending", "配对状态正在变化，请稍后重试")
	}
	if err != nil {
		return Token{}, err
	}
	finish := func(status, code, message string) (Token, error) {
		if status != "" {
			if err := q.ResolvePairing(ctx, sqlc.ResolvePairingParams{ID: request.ID, Status: status}); err != nil {
				return Token{}, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return Token{}, err
		}
		return Token{}, oauthError(code, message)
	}
	now := s.now()
	switch request.Status {
	case "consumed":
		return Token{}, oauthError("invalid_grant", "配对授权码已消费")
	case "denied":
		return Token{}, oauthError("access_denied", "配对已被拒绝")
	case "expired":
		return Token{}, oauthError("expired_token", "配对授权码已过期")
	}
	if !now.Before(request.ExpiresAt) {
		return finish("expired", "expired_token", "配对授权码已过期")
	}
	interval := request.IntervalMs
	if now.Before(request.NextPollAt) {
		interval += 5000
	}
	if err = q.SetPairingPoll(ctx, sqlc.SetPairingPollParams{ID: request.ID, IntervalMs: interval, NextPollAt: now.Add(time.Duration(interval) * time.Millisecond)}); err != nil {
		return Token{}, err
	}
	if now.Before(request.NextPollAt) {
		return finish("", "slow_down", "请降低配对轮询频率")
	}
	if request.Status == "pending" || request.Status == "joined" {
		return finish("", "authorization_pending", "等待用户批准配对")
	}
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	if request.CodeChallenge == nil || request.CodeChallengeMethod == nil || *request.CodeChallengeMethod != "S256" ||
		subtle.ConstantTimeCompare([]byte(challenge), []byte(*request.CodeChallenge)) != 1 {
		return finish("", "invalid_grant", "PKCE 校验失败")
	}
	changed, err := q.ConsumePairing(ctx, sqlc.ConsumePairingParams{ID: request.ID, Now: now})
	if err != nil {
		return Token{}, err
	}
	if changed != 1 {
		return Token{}, oauthError("invalid_grant", "配对授权码已失效")
	}
	access, err := randomToken(32)
	if err != nil {
		return Token{}, err
	}
	refresh, err := randomToken(48)
	if err != nil {
		return Token{}, err
	}
	grant, err := q.CreateGrant(ctx, sqlc.CreateGrantParams{UserID: request.CreatorUserID, ClientID: clientID, Scopes: mobilePairingScopes, Audience: Audience, ExpiresAt: now.Add(s.refreshTTL)})
	if err != nil {
		return Token{}, err
	}
	token := Token{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: int64(s.accessTTL.Seconds()), ExpiresAt: now.Add(s.accessTTL), GrantID: grant.ID, Scope: strings.Join(grant.Scopes, " ")}
	if _, err = q.CreateToken(ctx, sqlc.CreateTokenParams{UserID: request.CreatorUserID, ClientID: clientID, GrantID: grant.ID, AccessTokenHash: tokenHash(access), RefreshTokenHash: tokenHash(refresh), AccessExpiresAt: token.ExpiresAt, RefreshExpiresAt: grant.ExpiresAt}); err != nil {
		return Token{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Token{}, err
	}
	return token, nil
}
