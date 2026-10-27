package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const sessionCookie = "monkeyai_session"

var verifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

type Client struct {
	ID          string `json:"client_id"`
	Name        string `json:"name"`
	RedirectURI string `json:"redirect_uri"`
}

var Clients = map[string]Client{
	"monkeyai-runtime": {ID: RuntimeClientID, Name: "MonkeyAI Runtime"},
	"monkeyai-desktop": {
		ID:          "monkeyai-desktop",
		Name:        "MonkeyAI Desktop",
		RedirectURI: "monkeyai-desktop://oauth/callback",
	},
	"monkeyai-mobile": {
		ID:          "monkeyai-mobile",
		Name:        "MonkeyAI Mobile",
		RedirectURI: "monkeyai-mobile://oauth/callback",
	},
}

type User struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	AvatarURL   string     `json:"avatar_url,omitempty"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	JoinedAt    time.Time  `json:"joined_at"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

func userFromMember(value member.User) User {
	return User{
		ID: value.ID, Name: value.Name, Email: value.Email, AvatarURL: value.AvatarURL,
		Role: value.Role, Status: value.Status, JoinedAt: value.JoinedAt, LastLoginAt: value.LastLoginAt,
	}
}

type AuthorizationRequest struct {
	ID                  string
	ClientID            string
	RedirectURI         string
	State               string
	CodeChallenge       string
	CodeChallengeMethod string
	ExpiresAt           time.Time
	CompletedAt         *time.Time
	Scopes              []string
	Audience            string
}

type AuthorizationCode struct {
	ID            string
	UserID        string
	ClientID      string
	RedirectURI   string
	CodeChallenge string
	ExpiresAt     time.Time
	RedeemedAt    *time.Time
	Scopes        []string
	Audience      string
}

type LoginState struct {
	ConnectionID           string
	AuthorizationRequestID string
	DeviceRequestID        string
	Purpose                string
}

const (
	loginPurposeClient = "client"
	loginPurposeDevice = "device"
	loginPurposeAdmin  = "admin"
)

type Token struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int64     `json:"expires_in"`
	ExpiresAt    time.Time `json:"-"`
	GrantID      string    `json:"grant_id"`
	ServerID     string    `json:"server_id,omitempty"`
	MachineID    string    `json:"machine_id,omitempty"`
	Scope        string    `json:"scope"`
}

type SettingReader interface {
	GetValue(context.Context, string) (json.RawMessage, error)
}

type AccountPreserver interface {
	PreserveAccounts(context.Context, pgx.Tx) error
}

func (s *Service) WithAccountPreserver(p AccountPreserver) *Service { s.accounts = p; return s }

func (s *Service) WithUserWriter(writer member.UserWriter) *Service {
	if writer == nil {
		writer = member.EmptyUserWriter{}
	}
	s.writer = writer
	return s
}

type Service struct {
	device          *deviceAuthorization
	email           EmailSender
	accounts        AccountPreserver
	writer          member.UserWriter
	db              *pgxpool.Pool
	settings        SettingReader
	client          *http.Client
	publicURL       string
	secureCookie    bool
	now             func() time.Time
	sessionTTL      time.Duration
	requestTTL      time.Duration
	codeTTL         time.Duration
	accessTTL       time.Duration
	grantRevoker    func(string)
	runtimeFeatures func(context.Context) (map[string]bool, error)
	runtimeMetadata map[string]any
	refreshTTL      time.Duration
}

func NewService(db *pgxpool.Pool, settings SettingReader, publicURL string) *Service {
	return &Service{
		db:           db,
		settings:     settings,
		client:       &http.Client{Timeout: 15 * time.Second},
		publicURL:    strings.TrimRight(publicURL, "/"),
		secureCookie: strings.HasPrefix(publicURL, "https://"),
		now:          time.Now,
		sessionTTL:   7 * 24 * time.Hour,
		requestTTL:   10 * time.Minute,
		codeTTL:      2 * time.Minute,
		accessTTL:    time.Hour,
		refreshTTL:   30 * 24 * time.Hour,
		writer:       member.EmptyUserWriter{},
	}
}

func (s *Service) WithGrantRevoker(revoke func(string)) *Service {
	s.grantRevoker = revoke
	return s
}

func (s *Service) WithRuntimeFeatures(features func(context.Context) (map[string]bool, error)) *Service {
	s.runtimeFeatures = features
	return s
}

func (s *Service) WithRuntimeMetadata(metadata map[string]any) *Service {
	s.runtimeMetadata = metadata
	return s
}

func (s *Service) BeginAuthorization(ctx context.Context, values url.Values) (AuthorizationRequest, error) {
	request, err := s.newAuthorizationRequest(values)
	if err != nil {
		return AuthorizationRequest{}, err
	}
	if err := s.createAuthorizationRequest(ctx, &request); err != nil {
		return AuthorizationRequest{}, err
	}
	return request, nil
}

func (s *Service) newAuthorizationRequest(values url.Values) (AuthorizationRequest, error) {
	if values.Get("response_type") != "code" {
		return AuthorizationRequest{}, oauthError("unsupported_response_type", "仅支持 authorization code")
	}
	client, ok := Clients[values.Get("client_id")]
	if !ok || client.ID == RuntimeClientID {
		return AuthorizationRequest{}, oauthError("invalid_request", "client_id 无效")
	}
	redirectURI := values.Get("redirect_uri")
	if _, err := validateRedirectURI(client.ID, redirectURI); err != nil {
		return AuthorizationRequest{}, err
	}
	state := values.Get("state")
	if state == "" {
		return AuthorizationRequest{}, oauthError("invalid_request", "state 不能为空")
	}
	challenge := values.Get("code_challenge")
	if values.Get("code_challenge_method") != "S256" || !validChallenge(challenge) {
		return AuthorizationRequest{}, oauthError("invalid_request", "必须使用有效的 PKCE S256")
	}

	scopeValue := values.Get("scope")
	if client.ID == "monkeyai-desktop" && scopeValue == "" && s.deviceEnabled() {
		scopeValue = strings.Join([]string{"device:bind", "device:publish", "device:connect", "session:report"}, " ")
	}
	scopes, err := parseScopes(client.ID, scopeValue)
	if err != nil {
		return AuthorizationRequest{}, err
	}
	audience := values.Get("audience")
	if audience == "" {
		audience = Audience
	}
	if audience != Audience {
		return AuthorizationRequest{}, oauthError("invalid_target", "不支持请求的受众")
	}
	return AuthorizationRequest{
		ClientID:            client.ID,
		Scopes:              scopes,
		Audience:            audience,
		RedirectURI:         redirectURI,
		State:               state,
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
		ExpiresAt:           s.now().Add(s.requestTTL),
	}, nil
}

func (s *Service) CompleteAuthorization(ctx context.Context, requestID, userID string) (string, error) {
	return s.completeAuthorization(ctx, requestID, userID, nil)
}

func (s *Service) completeAuthorization(ctx context.Context, requestID, userID string, approval *[]string) (string, error) {
	request, err := s.authorizationRequest(ctx, requestID)
	if err != nil {
		return "", err
	}
	if request.CompletedAt != nil || !s.now().Before(request.ExpiresAt) {
		return "", errors.New("授权请求已完成或已过期")
	}
	callback, err := validateRedirectURI(request.ClientID, request.RedirectURI)
	if err != nil {
		return "", err
	}
	if approval == nil {
		return "", oauthError("consent_required", "客户端授权需要用户明确批准")
	}
	request.Scopes, err = approvedScopes(request.Scopes, *approval)
	if err != nil {
		return "", err
	}
	code, err := randomToken(32)
	if err != nil {
		return "", err
	}
	if err := s.storeAuthorizationCode(ctx, request, userID, tokenHash(code), s.now().Add(s.codeTTL)); err != nil {
		return "", err
	}
	query := callback.Query()
	query.Set("code", code)
	query.Set("state", request.State)
	callback.RawQuery = query.Encode()
	return callback.String(), nil
}

func (s *Service) ExchangeCode(ctx context.Context, clientID, redirectURI, code, verifier string) (Token, error) {
	if _, ok := Clients[clientID]; !ok {
		return Token{}, oauthError("invalid_client", "客户端信息无效")
	}
	if _, err := validateRedirectURI(clientID, redirectURI); err != nil {
		slog.WarnContext(ctx, "操作失败", "module", "identity", "operation", "ExchangeCode", "error", err)
		return Token{}, oauthError("invalid_grant", "授权回调地址无效")
	}
	if !verifierPattern.MatchString(verifier) {
		return Token{}, oauthError("invalid_grant", "code_verifier 无效")
	}
	stored, err := s.authorizationCode(ctx, tokenHash(code))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Token{}, err
	}
	if err != nil || stored.ClientID != clientID || stored.RedirectURI != redirectURI || stored.RedeemedAt != nil || !s.now().Before(stored.ExpiresAt) {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "identity", "operation", "ExchangeCode", "error", err)
		}
		return Token{}, oauthError("invalid_grant", "授权码无效或已过期")
	}
	digest := sha256.Sum256([]byte(verifier))
	actual := base64.RawURLEncoding.EncodeToString(digest[:])
	if subtle.ConstantTimeCompare([]byte(actual), []byte(stored.CodeChallenge)) != 1 {
		return Token{}, oauthError("invalid_grant", "PKCE 校验失败")
	}

	access, err := randomToken(32)
	if err != nil {
		return Token{}, err
	}
	refresh, err := randomToken(48)
	if err != nil {
		return Token{}, err
	}
	token := Token{
		AccessToken: access, RefreshToken: refresh, TokenType: "Bearer",
		ExpiresIn: int64(s.accessTTL.Seconds()), ExpiresAt: s.now().Add(s.accessTTL),
	}
	grant, err := s.redeemCodeAndStoreToken(ctx, stored, tokenHash(access), tokenHash(refresh), token.ExpiresAt, s.now().Add(s.refreshTTL))
	if err != nil {
		if errors.Is(err, errAuthorizationCodeUsed) {
			return Token{}, oauthError("invalid_grant", "授权码已被使用")
		}
		return Token{}, err
	}
	token.GrantID, token.Scope = grant.ID, strings.Join(grant.Scopes, " ")
	return token, nil
}

func (s *Service) Refresh(ctx context.Context, clientID, refreshToken string) (Token, error) {
	if _, ok := Clients[clientID]; !ok {
		return Token{}, oauthError("invalid_client", "客户端信息无效")
	}
	access, err := randomToken(32)
	if err != nil {
		return Token{}, err
	}
	refresh, err := randomToken(48)
	if err != nil {
		return Token{}, err
	}
	token := Token{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: int64(s.accessTTL.Seconds()), ExpiresAt: s.now().Add(s.accessTTL)}
	grant, err := s.rotateToken(ctx, tokenHash(refreshToken), clientID, tokenHash(access), tokenHash(refresh), token.ExpiresAt, s.now().Add(s.refreshTTL))
	if err != nil {
		if errors.Is(err, errInvalidGrant) {
			return Token{}, oauthError("invalid_grant", "refresh_token 无效或已过期")
		}
		return Token{}, err
	}
	token.GrantID, token.Scope = grant.ID, strings.Join(grant.Scopes, " ")
	if grant.Purpose == "runtime" && s.deviceEnabled() {
		token.ServerID = s.device.serverID
		if grant.RequestedMachineID != nil {
			token.MachineID = *grant.RequestedMachineID
		}
	}
	return token, nil
}

func validateRedirectURI(clientID, value string) (*url.URL, error) {
	if !validClientRedirect(clientID, value) {
		return nil, oauthError("invalid_request", "redirect_uri 未匹配客户端登记的回调地址")
	}
	return url.Parse(value)
}

func validChallenge(value string) bool {
	if len(value) != 43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil
}

func randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("生成安全随机数: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func tokenHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

type protocolError struct {
	Code        string `json:"error"`
	Description string `json:"error_description"`
}

func (e protocolError) Error() string { return e.Description }

func oauthError(code, description string) error {
	return protocolError{Code: code, Description: description}
}
