package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/user/provider"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/oss"
)

const (
	oauthLoginStatePrefix = "oauth_login_state:"
	oauthLoginStateTTL    = 5 * time.Minute
)

type OAuthLoginUsecase struct {
	repo           domain.OAuthLoginRepo
	redis          *redis.Client
	config         *config.Config
	logger         *slog.Logger
	providers      map[provider.Name]provider.Provider
	avatarArchiver oauthAvatarArchiver
}

type oauthAvatarArchiver interface {
	Archive(ctx context.Context, name provider.Name, identityID string, rawURL string) (string, error)
}

type oauthLoginState struct {
	Provider    string `json:"provider"`
	RedirectURL string `json:"redirect_url"`
	Nonce       string `json:"nonce,omitempty"`
}

func NewOAuthLoginUsecase(i *do.Injector) (domain.OAuthLoginUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	var avatarArchiver oauthAvatarArchiver
	if cfg.ObjectStorage.Enabled {
		client, err := oss.NewS3Compatible(context.Background(), cfg.ObjectStorage, oss.S3Option{
			ForcePathStyle: cfg.ObjectStorage.ForcePathStyle,
			InitBucket:     cfg.ObjectStorage.InitBucket,
		})
		if err != nil {
			return nil, err
		}
		avatarArchiver = provider.NewAvatarArchiver(cfg.ObjectStorage, nil, client)
	}
	return &OAuthLoginUsecase{
		repo:   do.MustInvoke[domain.OAuthLoginRepo](i),
		redis:  do.MustInvoke[*redis.Client](i),
		config: cfg,
		logger: do.MustInvoke[*slog.Logger](i).With("module", "usecase.oauth_login"),
		providers: map[provider.Name]provider.Provider{
			provider.Google: provider.NewGoogle(cfg.OAuthLogin.Google, cfg.Server.BaseURL, nil),
			provider.Github: provider.NewGithub(cfg.OAuthLogin.Github, cfg.Server.BaseURL, nil),
		},
		avatarArchiver: avatarArchiver,
	}, nil
}

func (u *OAuthLoginUsecase) StartOAuthLogin(ctx context.Context, providerName string, redirectURL string) (string, error) {
	name := provider.Name(strings.TrimSpace(providerName))
	if !u.providerEnabled(name) {
		return "", errcode.ErrOAuthLoginProviderDisabled
	}
	cleanRedirect, err := provider.CleanRedirectURL(redirectURL)
	if err != nil {
		return "", errcode.ErrOAuthLoginRedirectInvalid
	}
	p := u.providers[name]
	if p == nil {
		return "", errcode.ErrOAuthLoginProviderDisabled
	}
	state := randomOAuthToken()
	nonce := randomOAuthToken()
	value, err := json.Marshal(&oauthLoginState{
		Provider:    string(name),
		RedirectURL: cleanRedirect,
		Nonce:       nonce,
	})
	if err != nil {
		return "", err
	}
	if err := u.redis.Set(ctx, oauthLoginStatePrefix+state, string(value), oauthLoginStateTTL).Err(); err != nil {
		return "", err
	}
	return p.AuthCodeURL(state, nonce), nil
}

func (u *OAuthLoginUsecase) HandleOAuthCallback(ctx context.Context, providerName string, code string, state string) (*domain.OAuthLoginCallbackResp, error) {
	name := provider.Name(strings.TrimSpace(providerName))
	if !u.providerEnabled(name) {
		return nil, errcode.ErrOAuthLoginProviderDisabled
	}
	s, err := u.consumeState(ctx, state)
	if err != nil {
		return nil, errcode.ErrOAuthLoginStateInvalid
	}
	if s.Provider != string(name) {
		return nil, errcode.ErrOAuthLoginStateInvalid
	}
	p := u.providers[name]
	if p == nil {
		return nil, errcode.ErrOAuthLoginProviderDisabled
	}
	token, err := p.Exchange(ctx, code)
	if err != nil {
		u.logger.WarnContext(ctx, "oauth token exchange failed", "provider", name, "error", err)
		return nil, errcode.ErrOAuthLoginFailed
	}
	external, err := p.User(ctx, token, s.Nonce)
	if err != nil {
		u.logger.WarnContext(ctx, "oauth userinfo failed", "provider", name, "error", err)
		return nil, errcode.ErrOAuthLoginFailed
	}
	if external == nil || strings.TrimSpace(external.Email) == "" {
		return nil, errcode.ErrOAuthLoginEmailRequired
	}
	if !external.EmailVerified {
		return nil, errcode.ErrOAuthLoginEmailUnverified
	}
	user, err := u.resolveUser(ctx, external)
	if err != nil {
		return nil, err
	}
	return &domain.OAuthLoginCallbackResp{
		User:        cvt.From(user, &domain.User{}),
		RedirectURL: s.RedirectURL,
	}, nil
}

func (u *OAuthLoginUsecase) consumeState(ctx context.Context, state string) (*oauthLoginState, error) {
	value, err := u.redis.GetDel(ctx, oauthLoginStatePrefix+state).Result()
	if err != nil {
		return nil, err
	}
	var s oauthLoginState
	if err := json.Unmarshal([]byte(value), &s); err != nil {
		return nil, err
	}
	if s.RedirectURL == "" {
		s.RedirectURL = provider.DefaultRedirectURL
	}
	return &s, nil
}

func (u *OAuthLoginUsecase) resolveUser(ctx context.Context, external *provider.ExternalUser) (*db.User, error) {
	platform := oauthPlatform(external.Provider)
	avatarURL := u.archiveAvatar(ctx, external)
	loginUser := &domain.OAuthLoginUser{
		Provider:   platform,
		IdentityID: external.IdentityID,
		Email:      strings.ToLower(strings.TrimSpace(external.Email)),
		Username:   external.Username,
		Name:       external.Name,
		AvatarURL:  avatarURL,
	}
	usr, err := u.repo.FindUserByOAuthIdentity(ctx, platform, external.IdentityID)
	if err != nil && !db.IsNotFound(err) {
		return nil, err
	}
	if err == nil && usr != nil {
		if err := validateOAuthLoginUser(usr); err != nil {
			return nil, err
		}
		if err := u.repo.UpdateOAuthIdentity(ctx, loginUser); err != nil {
			return nil, err
		}
		return usr, nil
	}
	usr, err = u.repo.FindIndividualByEmail(ctx, loginUser.Email)
	if err != nil {
		return nil, err
	}
	if usr != nil {
		if err := validateOAuthLoginUser(usr); err != nil {
			return nil, err
		}
		if err := u.repo.BindOAuthIdentity(ctx, usr.ID, loginUser); err != nil {
			return nil, err
		}
		return usr, nil
	}
	usr, err = u.repo.CreateIndividualWithIdentity(ctx, loginUser)
	if err != nil {
		return nil, err
	}
	if err := validateOAuthLoginUser(usr); err != nil {
		return nil, err
	}
	return usr, nil
}

func (u *OAuthLoginUsecase) archiveAvatar(ctx context.Context, external *provider.ExternalUser) string {
	if u == nil || external == nil {
		return ""
	}
	if strings.TrimSpace(external.AvatarURL) == "" {
		u.logAvatarArchiveSkipped(ctx, external, "empty_avatar_url")
		return ""
	}
	if u.avatarArchiver == nil {
		u.logAvatarArchiveSkipped(ctx, external, "object_storage_disabled")
		return ""
	}
	avatarURL, err := u.avatarArchiver.Archive(ctx, external.Provider, external.IdentityID, external.AvatarURL)
	if err != nil {
		u.logger.WarnContext(ctx, "archive oauth avatar failed", "provider", external.Provider, "identity_id", external.IdentityID, "error", err)
		return ""
	}
	if avatarURL == "" {
		u.logAvatarArchiveSkipped(ctx, external, "archived_avatar_url_empty")
		return ""
	}
	return avatarURL
}

func (u *OAuthLoginUsecase) logAvatarArchiveSkipped(ctx context.Context, external *provider.ExternalUser, reason string) {
	if u == nil || u.logger == nil || external == nil {
		return
	}
	u.logger.WarnContext(ctx, "skip oauth avatar archive",
		"provider", external.Provider,
		"identity_id", external.IdentityID,
		"reason", reason,
		"avatar_url_present", strings.TrimSpace(external.AvatarURL) != "",
	)
}

func validateOAuthLoginUser(usr *db.User) error {
	if usr == nil {
		return errcode.ErrOAuthLoginFailed
	}
	if usr.Role != consts.UserRoleIndividual {
		return errcode.ErrOAuthLoginRoleDenied
	}
	if usr.IsBlocked {
		return errcode.ErrUserBlocked
	}
	return nil
}

func (u *OAuthLoginUsecase) providerEnabled(name provider.Name) bool {
	switch name {
	case provider.Google:
		return u.config.OAuthLogin.Google.Enabled && u.config.OAuthLogin.Google.ClientID != "" && u.config.OAuthLogin.Google.ClientSecret != ""
	case provider.Github:
		return u.config.OAuthLogin.Github.Enabled && u.config.OAuthLogin.Github.ClientID != "" && u.config.OAuthLogin.Github.ClientSecret != ""
	default:
		return false
	}
}

func oauthPlatform(name provider.Name) consts.UserPlatform {
	switch name {
	case provider.Google:
		return consts.UserPlatformGoogle
	case provider.Github:
		return consts.UserPlatformGithub
	default:
		return consts.UserPlatform(name)
	}
}

func randomOAuthToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
