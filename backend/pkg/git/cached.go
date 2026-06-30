package git

import (
	"context"
	"fmt"

	gocache "github.com/patrickmn/go-cache"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// CachedGitClient wraps a GitClienter and adds in-memory caching for Repositories.
type CachedGitClient struct {
	inner    domain.GitClienter
	cache    *gocache.Cache
	cacheKey string
}

func NewCachedGitClient(inner domain.GitClienter, c *gocache.Cache, cacheKey string) *CachedGitClient {
	return &CachedGitClient{inner: inner, cache: c, cacheKey: cacheKey}
}

func (c *CachedGitClient) Repositories(ctx context.Context, opts *domain.RepositoryOptions) (*domain.RepositoryPage, error) {
	// 全量列表用 cacheKey；分页结果按 keyword/page/size 分别缓存。
	key := c.cacheKey
	if opts.Page > 0 {
		key = fmt.Sprintf("%s:page:%s:%d:%d", c.cacheKey, opts.Keyword, opts.Page, opts.Size)
	}
	if !opts.Flush {
		if cached, ok := c.cache.Get(key); ok {
			return cached.(*domain.RepositoryPage), nil
		}
	}
	page, err := c.inner.Repositories(ctx, opts)
	if err != nil {
		return nil, err
	}
	c.cache.Set(key, page, gocache.DefaultExpiration)
	return page, nil
}

func (c *CachedGitClient) CheckPAT(ctx context.Context, token, repoURL string) (bool, *domain.BindRepository, error) {
	return c.inner.CheckPAT(ctx, token, repoURL)
}

func (c *CachedGitClient) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	return c.inner.UserInfo(ctx, token)
}

func (c *CachedGitClient) Tree(ctx context.Context, opts *domain.TreeOptions) (*domain.GetRepoTreeResp, error) {
	return c.inner.Tree(ctx, opts)
}

func (c *CachedGitClient) Blob(ctx context.Context, opts *domain.BlobOptions) (*domain.GetBlobResp, error) {
	return c.inner.Blob(ctx, opts)
}

func (c *CachedGitClient) Logs(ctx context.Context, opts *domain.LogsOptions) (*domain.GetGitLogsResp, error) {
	return c.inner.Logs(ctx, opts)
}

func (c *CachedGitClient) Archive(ctx context.Context, opts *domain.ArchiveOptions) (*domain.GetRepoArchiveResp, error) {
	return c.inner.Archive(ctx, opts)
}

func (c *CachedGitClient) Branches(ctx context.Context, opts *domain.BranchesOptions) ([]*domain.BranchInfo, error) {
	return c.inner.Branches(ctx, opts)
}

func (c *CachedGitClient) DeleteWebhook(ctx context.Context, opts *domain.WebhookOptions) error {
	return c.inner.DeleteWebhook(ctx, opts)
}

func (c *CachedGitClient) CreateWebhook(ctx context.Context, opts *domain.CreateWebhookOptions) error {
	return c.inner.CreateWebhook(ctx, opts)
}
