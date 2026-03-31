package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/github"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/oauth"
)

const tokenCacheTTL = 50 * time.Minute // 略小于 GitHub App 1h 有效期
const tokenExpiryBuffer = 5 * time.Minute

// TokenProvider 统一 token 获取，支持 PAT / GitHub App / OAuth 刷新
type TokenProvider struct {
	repo         domain.GitIdentityRepo
	gh           *github.Github
	siteResolver domain.SiteResolver // 可选，内部项目注入
	proxies      []string
	tokenCache   *cache.Cache
	logger       *slog.Logger
}

// NewTokenProvider 创建 TokenProvider
func NewTokenProvider(i *do.Injector) (*TokenProvider, error) {
	cfg := do.MustInvoke[*config.Config](i)
	logger := do.MustInvoke[*slog.Logger](i)
	tp := &TokenProvider{
		repo:       do.MustInvoke[domain.GitIdentityRepo](i),
		gh:         github.NewGithub(logger, cfg),
		proxies:    cfg.Proxies,
		tokenCache: cache.New(tokenCacheTTL, 10*time.Minute),
		logger:     logger.With("module", "TokenProvider"),
	}
	// 可选注入 SiteResolver（内部项目通过 WithSiteResolver 提供）
	if sr, err := do.Invoke[domain.SiteResolver](i); err == nil {
		tp.siteResolver = sr
	}
	return tp, nil
}

// GetToken 获取 identity 对应的有效 access token
func (p *TokenProvider) GetToken(ctx context.Context, identityID uuid.UUID) (string, error) {
	// 1. 检查缓存
	cacheKey := identityID.String()
	if tok, ok := p.tokenCache.Get(cacheKey); ok {
		return tok.(string), nil
	}

	// 2. 从 DB 加载 identity
	gi, err := p.repo.Get(ctx, identityID)
	if err != nil {
		return "", fmt.Errorf("get git identity: %w", err)
	}

	// 3. 根据平台获取 token
	token, ttl, err := p.resolveToken(ctx, gi)
	if err != nil {
		return "", err
	}

	// 4. 缓存
	if ttl <= 0 {
		ttl = tokenCacheTTL
	}
	p.tokenCache.Set(cacheKey, token, ttl)
	return token, nil
}

// resolveToken 根据平台类型获取有效 token，返回 (token, cacheTTL, error)
func (p *TokenProvider) resolveToken(ctx context.Context, gi *db.GitIdentity) (string, time.Duration, error) {
	switch gi.Platform {
	case consts.GitPlatformGithub:
		return p.resolveGithub(ctx, gi)
	case consts.GitPlatformGitLab:
		return p.resolveOAuth(ctx, gi, p.refreshGitlab)
	case consts.GitPlatformGitea:
		return p.resolveOAuth(ctx, gi, p.refreshGitea)
	case consts.GitPlatformGitee:
		return p.resolveOAuth(ctx, gi, p.refreshGitee)
	default:
		if gi.AccessToken == "" {
			return "", 0, fmt.Errorf("git identity %s has no access token", gi.ID)
		}
		return gi.AccessToken, tokenCacheTTL, nil
	}
}

// ── GitHub ─────────────────────────────────────────────────────

func (p *TokenProvider) resolveGithub(ctx context.Context, gi *db.GitIdentity) (string, time.Duration, error) {
	// GitHub App: 使用 installation token
	if gi.InstallationID > 0 {
		token, err := p.gh.GetInstallationToken(ctx, gi.InstallationID)
		if err != nil {
			return "", 0, fmt.Errorf("get github installation token: %w", err)
		}
		return token, tokenCacheTTL, nil
	}
	// PAT
	if gi.AccessToken == "" {
		return "", 0, fmt.Errorf("github identity %s has no access token", gi.ID)
	}
	return gi.AccessToken, tokenCacheTTL, nil
}

// ── OAuth 通用刷新 ─────────────────────────────────────────────

// refreshFunc OAuth 刷新函数签名
type refreshFunc func(ctx context.Context, gi *db.GitIdentity) (newToken, newRefresh string, expiresAt time.Time, err error)

func (p *TokenProvider) resolveOAuth(ctx context.Context, gi *db.GitIdentity, refresh refreshFunc) (string, time.Duration, error) {
	// 有 refresh token 且已过期（或即将过期）→ 刷新
	if gi.OauthRefreshToken != "" && p.isTokenExpired(gi) {
		token, newRefresh, expiresAt, err := refresh(ctx, gi)
		if err != nil {
			p.logger.WarnContext(ctx, "oauth refresh failed, fallback to stored token",
				"identity_id", gi.ID, "platform", gi.Platform, "error", err)
			// 刷新失败，回退到已存储的 token
			if gi.AccessToken != "" {
				return gi.AccessToken, time.Minute, nil // 短 TTL 以便尽快重试
			}
			return "", 0, fmt.Errorf("oauth refresh failed and no stored token: %w", err)
		}

		// 持久化刷新后的 token
		newTokenPtr := &token
		newRefreshPtr := &newRefresh
		expiresAtPtr := &expiresAt
		if err := p.repo.Update(ctx, gi.UserID, gi.ID, &domain.UpdateGitIdentityReq{
			ID:                gi.ID,
			AccessToken:       newTokenPtr,
			OAuthRefreshToken: newRefreshPtr,
			OAuthExpiresAt:    expiresAtPtr,
		}); err != nil {
			p.logger.ErrorContext(ctx, "failed to persist refreshed token", "identity_id", gi.ID, "error", err)
		}

		ttl := p.calcCacheTTL(expiresAt)
		return token, ttl, nil
	}

	// PAT 或 token 未过期
	if gi.AccessToken == "" {
		return "", 0, fmt.Errorf("git identity %s has no access token", gi.ID)
	}

	ttl := tokenCacheTTL
	if gi.OauthExpiresAt != nil {
		ttl = p.calcCacheTTL(*gi.OauthExpiresAt)
	}
	return gi.AccessToken, ttl, nil
}

func (p *TokenProvider) isTokenExpired(gi *db.GitIdentity) bool {
	if gi.OauthExpiresAt == nil {
		return true // 无过期时间记录，视为需要刷新
	}
	return time.Until(*gi.OauthExpiresAt) < tokenExpiryBuffer
}

func (p *TokenProvider) calcCacheTTL(expiresAt time.Time) time.Duration {
	remaining := time.Until(expiresAt) - tokenExpiryBuffer
	if remaining <= 0 {
		return time.Minute
	}
	if remaining > tokenCacheTTL {
		return tokenCacheTTL
	}
	return remaining
}

// ── 平台刷新实现 ───────────────────────────────────────────────

func (p *TokenProvider) refreshGitlab(ctx context.Context, gi *db.GitIdentity) (string, string, time.Time, error) {
	site, err := p.resolveSiteConfig(ctx, gi.BaseURL)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("resolve gitlab site: %w", err)
	}
	resp, err := oauth.RefreshGitlab(gi.BaseURL, site.ClientID, site.ClientSecret, gi.OauthRefreshToken, p.proxies...)
	if err != nil {
		return "", "", time.Time{}, err
	}
	return resp.AccessToken, resp.RefreshToken, time.Unix(resp.ExpiresAt(), 0), nil
}

func (p *TokenProvider) refreshGitea(ctx context.Context, gi *db.GitIdentity) (string, string, time.Time, error) {
	site, err := p.resolveSiteConfig(ctx, gi.BaseURL)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("resolve gitea site: %w", err)
	}
	resp, err := oauth.RefreshGitea(gi.BaseURL, site.ClientID, site.ClientSecret, gi.OauthRefreshToken, p.proxies...)
	if err != nil {
		return "", "", time.Time{}, err
	}
	return resp.AccessToken, resp.RefreshToken, time.Unix(resp.ExpiresAt(), 0), nil
}

func (p *TokenProvider) refreshGitee(_ context.Context, gi *db.GitIdentity) (string, string, time.Time, error) {
	resp, err := oauth.RefreshGitee(gi.OauthRefreshToken)
	if err != nil {
		return "", "", time.Time{}, err
	}
	return resp.AccessToken, resp.RefreshToken, time.Unix(resp.ExpiresAt(), 0), nil
}

// resolveSiteConfig 通过 baseURL 的 host 获取 OAuth 配置
func (p *TokenProvider) resolveSiteConfig(ctx context.Context, baseURL string) (*domain.OAuthSiteConfig, error) {
	if p.siteResolver == nil {
		return nil, fmt.Errorf("site resolver not available")
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse base url %q: %w", baseURL, err)
	}
	return p.siteResolver.ResolveByHost(ctx, u.Host)
}
