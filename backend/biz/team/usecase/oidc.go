package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"
	"golang.org/x/oauth2"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	oidcpkg "github.com/chaitin/MonkeyCode/backend/pkg/oidc"
)

const oidcStatePrefix = "team_oidc_state:"
const oidcDebugValueMaxLen = 256

type TeamOIDCUsecase struct {
	repo   domain.TeamOIDCRepo
	cfg    *config.Config
	redis  *redis.Client
	oidc   *oidcpkg.Client
	logger *slog.Logger
}

func NewTeamOIDCUsecase(i *do.Injector) (domain.TeamOIDCUsecase, error) {
	return newTeamOIDCUsecase(i)
}

func NewTeamOIDCLoginUsecase(i *do.Injector) (domain.TeamOIDCLoginUsecase, error) {
	return newTeamOIDCUsecase(i)
}

func newTeamOIDCUsecase(i *do.Injector) (*TeamOIDCUsecase, error) {
	return &TeamOIDCUsecase{
		repo:   do.MustInvoke[domain.TeamOIDCRepo](i),
		cfg:    do.MustInvoke[*config.Config](i),
		redis:  do.MustInvoke[*redis.Client](i),
		oidc:   oidcpkg.NewClient(nil),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "usecase.team_oidc"),
	}, nil
}

func (u *TeamOIDCUsecase) GetConfig(ctx context.Context, teamUser *domain.TeamUser) (*domain.TeamOIDCConfigResp, error) {
	cfg, err := u.repo.GetConfig(ctx, teamUser.GetTeamID())
	if err != nil {
		if db.IsNotFound(err) {
			return &domain.TeamOIDCConfigResp{Config: u.emptyConfig(teamUser.GetTeamID())}, nil
		}
		return nil, err
	}
	return &domain.TeamOIDCConfigResp{Config: u.configResp(cfg)}, nil
}

func (u *TeamOIDCUsecase) SaveConfig(ctx context.Context, teamUser *domain.TeamUser, req *domain.SaveTeamOIDCConfigReq) (*domain.TeamOIDCConfigResp, error) {
	req.Issuer = oidcpkg.CleanIssuer(req.Issuer)
	if req.Scopes == "" {
		req.Scopes = "openid email profile"
	}
	if req.DisplayName == "" {
		req.DisplayName = "企业登录"
	}
	cfg, err := u.repo.UpsertConfig(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	return &domain.TeamOIDCConfigResp{Config: u.configResp(cfg)}, nil
}

func (u *TeamOIDCUsecase) TestConfig(ctx context.Context, _ *domain.TeamUser, req *domain.SaveTeamOIDCConfigReq) (*domain.TeamOIDCTestResp, error) {
	doc, err := u.oidc.Discover(ctx, req.Issuer)
	if err != nil {
		return nil, errcode.ErrOIDCConfigInvalid.Wrap(err)
	}
	return &domain.TeamOIDCTestResp{Success: true, Issuer: doc.Issuer, Message: "ok"}, nil
}

func (u *TeamOIDCUsecase) StartLogin(ctx context.Context, teamID uuid.UUID) (string, error) {
	cfg, err := u.repo.GetConfig(ctx, teamID)
	if err != nil {
		return "", errcode.ErrOIDCDisabled.Wrap(err)
	}
	if !cfg.Enabled {
		return "", errcode.ErrOIDCDisabled
	}
	doc, err := u.oidc.Discover(ctx, cfg.Issuer)
	if err != nil {
		return "", errcode.ErrOIDCConfigInvalid.Wrap(err)
	}
	state := randomURLToken()
	nonce := randomURLToken()
	value := fmt.Sprintf("%s|%s", teamID.String(), nonce)
	if err := u.redis.Set(ctx, oidcStatePrefix+state, value, 5*time.Minute).Err(); err != nil {
		return "", err
	}
	oauthCfg := oidcpkg.OAuthConfig(doc, oidcpkg.Config{
		Issuer:       cfg.Issuer,
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecretCiphertext,
		RedirectURL:  u.redirectURI(),
		Scopes:       oidcpkg.SplitScopes(cfg.Scopes),
	})
	return oauthCfg.AuthCodeURL(state, oauth2.SetAuthURLParam("nonce", nonce)), nil
}

func (u *TeamOIDCUsecase) HandleCallback(ctx context.Context, req *domain.TeamOIDCCallbackReq) (*domain.User, error) {
	u.logger.DebugContext(ctx, "oidc callback: received",
		"state_present", req.State != "",
		"state_len", len(req.State),
		"code_present", req.Code != "",
		"code_len", len(req.Code),
	)
	value, err := u.redis.GetDel(ctx, oidcStatePrefix+req.State).Result()
	if err != nil {
		return nil, errcode.ErrOIDCStateInvalid.Wrap(err)
	}
	parts := strings.SplitN(value, "|", 2)
	if len(parts) != 2 {
		return nil, errcode.ErrOIDCStateInvalid
	}
	teamID, err := uuid.Parse(parts[0])
	if err != nil {
		return nil, errcode.ErrOIDCStateInvalid.Wrap(err)
	}
	nonce := parts[1]
	u.logger.DebugContext(ctx, "oidc callback: state validated",
		"team_id", teamID,
		"nonce_present", nonce != "",
		"nonce_len", len(nonce),
	)

	cfg, err := u.repo.GetConfig(ctx, teamID)
	if err != nil || !cfg.Enabled {
		u.logger.DebugContext(ctx, "oidc callback: config unavailable",
			"team_id", teamID,
			"error", err,
		)
		return nil, errcode.ErrOIDCDisabled.Wrap(err)
	}
	u.logger.DebugContext(ctx, "oidc callback: config loaded",
		"team_id", teamID,
		"issuer", cfg.Issuer,
		"client_id", cfg.ClientID,
		"scopes", cfg.Scopes,
		"email_domain", cfg.EmailDomain,
		"auto_create_member", cfg.AutoCreateMember,
		"allow_password_login", cfg.AllowPasswordLogin,
	)
	doc, err := u.oidc.Discover(ctx, cfg.Issuer)
	if err != nil {
		return nil, errcode.ErrOIDCConfigInvalid.Wrap(err)
	}
	u.logger.DebugContext(ctx, "oidc callback: discovery loaded",
		"team_id", teamID,
		"issuer", doc.Issuer,
		"authorization_endpoint", doc.AuthorizationEndpoint,
		"token_endpoint", doc.TokenEndpoint,
		"userinfo_endpoint", doc.UserinfoEndpoint,
	)
	oauthCfg := oidcpkg.OAuthConfig(doc, oidcpkg.Config{
		Issuer:       cfg.Issuer,
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecretCiphertext,
		RedirectURL:  u.redirectURI(),
		Scopes:       oidcpkg.SplitScopes(cfg.Scopes),
	})
	token, err := oauthCfg.Exchange(ctx, req.Code)
	if err != nil {
		return nil, errcode.ErrOIDCTokenInvalid.Wrap(err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	u.logger.DebugContext(ctx, "oidc callback: token exchanged",
		"team_id", teamID,
		"token_type", token.TokenType,
		"expiry", token.Expiry,
		"has_access_token", token.AccessToken != "",
		"has_refresh_token", token.RefreshToken != "",
		"has_id_token", ok && rawIDToken != "",
	)
	if !ok || rawIDToken == "" {
		return nil, errcode.ErrOIDCTokenInvalid
	}
	external, err := u.oidc.VerifyIDToken(ctx, doc, oidcpkg.Config{ClientID: cfg.ClientID}, rawIDToken, nonce)
	if err != nil {
		return nil, errcode.ErrOIDCTokenInvalid.Wrap(err)
	}
	u.logger.DebugContext(ctx, "oidc callback: id token verified",
		append([]any{"team_id", teamID, "source", "id_token"}, oidcExternalUserLogAttrs(external)...)...,
	)
	if external.Email == "" || external.Name == "" || external.AvatarURL == "" {
		u.logger.DebugContext(ctx, "oidc callback: userinfo required",
			"team_id", teamID,
			"missing_email", external.Email == "",
			"missing_name", external.Name == "",
			"missing_avatar_url", external.AvatarURL == "",
		)
		enriched, infoErr := u.oidc.UserInfo(ctx, doc, oauthCfg.TokenSource(ctx, token), external)
		if enriched != nil {
			external = enriched
		}
		if infoErr != nil {
			u.logger.DebugContext(ctx, "oidc callback: userinfo fetch failed", "team_id", teamID, "error", infoErr)
		} else {
			u.logger.DebugContext(ctx, "oidc callback: userinfo loaded",
				append([]any{"team_id", teamID, "source", "userinfo"}, oidcExternalUserLogAttrs(external)...)...,
			)
		}
	}
	if external.Email == "" {
		u.logger.DebugContext(ctx, "oidc callback: email missing",
			append([]any{"team_id", teamID}, oidcExternalUserLogAttrs(external)...)...,
		)
		return nil, errcode.ErrOIDCEmailRequired
	}
	if !external.EmailVerified {
		u.logger.DebugContext(ctx, "oidc callback: email not verified",
			append([]any{"team_id", teamID}, oidcExternalUserLogAttrs(external)...)...,
		)
		return nil, errcode.ErrOIDCEmailNotVerified
	}
	if !oidcEmailDomainAllowed(external.Email, cfg.EmailDomain) {
		u.logger.DebugContext(ctx, "oidc callback: email domain denied",
			append([]any{"team_id", teamID, "email_domain", cfg.EmailDomain}, oidcExternalUserLogAttrs(external)...)...,
		)
		return nil, errcode.ErrOIDCEmailDomainDenied
	}

	identityID := oidcpkg.IdentityID(external.Issuer, external.Subject)
	u.logger.DebugContext(ctx, "oidc callback: identity resolved",
		"team_id", teamID,
		"identity_id", identityID,
		"identity_id_len", len(identityID),
		"issuer_len", len(external.Issuer),
		"subject_len", len(external.Subject),
	)
	user, err := u.repo.FindUserByOIDCIdentity(ctx, identityID)
	if err != nil && !db.IsNotFound(err) {
		return nil, err
	}
	if user == nil {
		u.logger.DebugContext(ctx, "oidc callback: identity not bound, checking team member",
			"team_id", teamID,
			"email", external.Email,
			"auto_create_member", cfg.AutoCreateMember,
		)
		member, err := u.repo.FindTeamMemberByEmail(ctx, teamID, external.Email)
		if err == nil && member.Edges.User != nil {
			user = member.Edges.User
			u.logger.DebugContext(ctx, "oidc callback: matched existing team member",
				"team_id", teamID,
				"user_id", user.ID,
				"email", external.Email,
			)
		} else if db.IsNotFound(err) && cfg.AutoCreateMember {
			u.logger.DebugContext(ctx, "oidc callback: auto creating team member",
				"team_id", teamID,
				"email", external.Email,
				"name", oidcDisplayName(external),
			)
			user, err = u.repo.AutoCreateMember(ctx, teamID, external)
			if err != nil {
				return nil, err
			}
			u.logger.DebugContext(ctx, "oidc callback: auto created team member",
				"team_id", teamID,
				"user_id", user.ID,
				"email", external.Email,
			)
		} else if db.IsNotFound(err) {
			u.logger.DebugContext(ctx, "oidc callback: team member required",
				"team_id", teamID,
				"email", external.Email,
			)
			return nil, errcode.ErrOIDCTeamMemberRequired
		} else if err != nil {
			return nil, err
		}
	} else {
		u.logger.DebugContext(ctx, "oidc callback: matched bound identity",
			"team_id", teamID,
			"user_id", user.ID,
			"identity_id_len", len(identityID),
		)
	}
	if user.IsBlocked {
		u.logger.DebugContext(ctx, "oidc callback: user blocked", "team_id", teamID, "user_id", user.ID)
		return nil, errcode.ErrUserBlocked
	}
	if err := u.repo.BindOIDCIdentity(ctx, user.ID, external); err != nil {
		return nil, err
	}
	u.logger.DebugContext(ctx, "oidc callback: login success",
		"team_id", teamID,
		"user_id", user.ID,
		"identity_id_len", len(identityID),
		"email", external.Email,
	)
	return cvt.From(user, &domain.User{}), nil
}

func (u *TeamOIDCUsecase) PublicConfig(ctx context.Context, teamID uuid.UUID) (*domain.TeamOIDCPublicConfigResp, error) {
	cfg, err := u.repo.GetConfig(ctx, teamID)
	if err != nil || !cfg.Enabled {
		return &domain.TeamOIDCPublicConfigResp{TeamID: teamID, Enabled: false}, nil
	}
	return u.publicConfigResp(cfg), nil
}

func (u *TeamOIDCUsecase) DefaultPublicConfig(ctx context.Context) (*domain.TeamOIDCPublicConfigResp, error) {
	cfg, err := u.repo.GetDefaultEnabledConfig(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return &domain.TeamOIDCPublicConfigResp{Enabled: false}, nil
		}
		return nil, err
	}
	return u.publicConfigResp(cfg), nil
}

func (u *TeamOIDCUsecase) publicConfigResp(cfg *db.TeamOIDCConfig) *domain.TeamOIDCPublicConfigResp {
	return &domain.TeamOIDCPublicConfigResp{
		TeamID:      cfg.TeamID,
		Enabled:     true,
		DisplayName: cfg.DisplayName,
		LoginURL:    strings.TrimRight(u.cfg.Server.BaseURL, "/") + "/api/v1/users/oidc/login?team_id=" + cfg.TeamID.String(),
	}
}

func (u *TeamOIDCUsecase) PasswordLoginAllowed(ctx context.Context, teamID uuid.UUID) (bool, error) {
	cfg, err := u.repo.GetConfig(ctx, teamID)
	if err != nil {
		if db.IsNotFound(err) {
			return true, nil
		}
		return false, err
	}
	return !cfg.Enabled || cfg.AllowPasswordLogin, nil
}

func (u *TeamOIDCUsecase) emptyConfig(teamID uuid.UUID) *domain.TeamOIDCConfig {
	return &domain.TeamOIDCConfig{
		TeamID:             teamID,
		DisplayName:        "企业登录",
		Scopes:             "openid email profile",
		AllowPasswordLogin: true,
		RedirectURI:        u.redirectURI(),
		LoginURL:           u.loginURL(teamID),
	}
}

func (u *TeamOIDCUsecase) configResp(cfg *db.TeamOIDCConfig) *domain.TeamOIDCConfig {
	return &domain.TeamOIDCConfig{
		ID:                 cfg.ID,
		TeamID:             cfg.TeamID,
		Enabled:            cfg.Enabled,
		DisplayName:        cfg.DisplayName,
		Issuer:             cfg.Issuer,
		ClientID:           cfg.ClientID,
		HasClientSecret:    cfg.ClientSecretCiphertext != "",
		Scopes:             cfg.Scopes,
		EmailDomain:        cfg.EmailDomain,
		AutoCreateMember:   cfg.AutoCreateMember,
		AllowPasswordLogin: cfg.AllowPasswordLogin,
		RedirectURI:        u.redirectURI(),
		LoginURL:           u.loginURL(cfg.TeamID),
	}
}

func (u *TeamOIDCUsecase) redirectURI() string {
	return strings.TrimRight(u.cfg.Server.BaseURL, "/") + "/api/v1/users/oidc/callback"
}

func (u *TeamOIDCUsecase) loginURL(teamID uuid.UUID) string {
	return strings.TrimRight(u.cfg.Server.BaseURL, "/") + "/team-login/" + teamID.String()
}

func oidcEmailDomainAllowed(email, domain string) bool {
	domain = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(domain)), "@")
	if domain == "" {
		return true
	}
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(email)), "@"+domain)
}

func oidcDisplayName(external *domain.OIDCExternalUser) string {
	if external.Name != "" {
		return external.Name
	}
	if external.Username != "" {
		return external.Username
	}
	if idx := strings.IndexByte(external.Email, '@'); idx > 0 {
		return external.Email[:idx]
	}
	return external.Email
}

func oidcExternalUserLogAttrs(external *domain.OIDCExternalUser) []any {
	if external == nil {
		return []any{"external_user_nil", true}
	}
	return []any{
		"issuer", external.Issuer,
		"issuer_len", len(external.Issuer),
		"subject", external.Subject,
		"subject_len", len(external.Subject),
		"email", external.Email,
		"email_present", external.Email != "",
		"email_verified", external.EmailVerified,
		"name", external.Name,
		"name_present", external.Name != "",
		"username", external.Username,
		"username_present", external.Username != "",
		"avatar_url", oidcShortDebugValue(external.AvatarURL),
		"avatar_url_present", external.AvatarURL != "",
		"avatar_url_len", len(external.AvatarURL),
	}
}

func oidcShortDebugValue(value string) string {
	if len(value) <= oidcDebugValueMaxLen {
		return value
	}
	return value[:oidcDebugValueMaxLen] + "...(truncated)"
}

func randomURLToken() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}
