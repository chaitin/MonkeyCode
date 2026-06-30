package git

import (
	"context"
	"testing"
	"time"

	gocache "github.com/patrickmn/go-cache"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// fakeClient 实现 domain.GitClienter，仅记录 Repositories 调用次数与入参，其余方法返回零值。
type fakeClient struct {
	calls int
	last  *domain.RepositoryOptions
}

func (f *fakeClient) Repositories(ctx context.Context, opts *domain.RepositoryOptions) (*domain.RepositoryPage, error) {
	f.calls++
	f.last = opts
	return &domain.RepositoryPage{Repositories: []domain.AuthRepository{{FullName: "o/r"}}}, nil
}

func (f *fakeClient) CheckPAT(ctx context.Context, token, repoURL string) (bool, *domain.BindRepository, error) {
	return false, nil, nil
}
func (f *fakeClient) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	return nil, nil
}
func (f *fakeClient) Tree(ctx context.Context, opts *domain.TreeOptions) (*domain.GetRepoTreeResp, error) {
	return nil, nil
}
func (f *fakeClient) Blob(ctx context.Context, opts *domain.BlobOptions) (*domain.GetBlobResp, error) {
	return nil, nil
}
func (f *fakeClient) Logs(ctx context.Context, opts *domain.LogsOptions) (*domain.GetGitLogsResp, error) {
	return nil, nil
}
func (f *fakeClient) Archive(ctx context.Context, opts *domain.ArchiveOptions) (*domain.GetRepoArchiveResp, error) {
	return nil, nil
}
func (f *fakeClient) Branches(ctx context.Context, opts *domain.BranchesOptions) ([]*domain.BranchInfo, error) {
	return nil, nil
}
func (f *fakeClient) DeleteWebhook(ctx context.Context, opts *domain.WebhookOptions) error { return nil }
func (f *fakeClient) CreateWebhook(ctx context.Context, opts *domain.CreateWebhookOptions) error {
	return nil
}

func newCache() *gocache.Cache { return gocache.New(5*time.Minute, 10*time.Minute) }

func TestCachedRepositories_FullList(t *testing.T) {
	ctx := context.Background()
	inner := &fakeClient{}
	cache := newCache()
	c := NewCachedGitClient(inner, cache, "u:i")

	if _, err := c.Repositories(ctx, &domain.RepositoryOptions{}); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 1 {
		t.Fatalf("first call: inner.calls = %d, want 1", inner.calls)
	}
	// 全量列表使用 cacheKey 本身。
	if _, ok := cache.Get("u:i"); !ok {
		t.Errorf("expected full-list cached under key %q", "u:i")
	}

	// 第二次命中缓存，不回源。
	if _, err := c.Repositories(ctx, &domain.RepositoryOptions{}); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 1 {
		t.Errorf("cached call should not hit inner: inner.calls = %d, want 1", inner.calls)
	}

	// Flush 绕过缓存，回源。
	if _, err := c.Repositories(ctx, &domain.RepositoryOptions{Flush: true}); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 2 {
		t.Errorf("flush should hit inner: inner.calls = %d, want 2", inner.calls)
	}
}

func TestCachedRepositories_PerPageKeys(t *testing.T) {
	ctx := context.Background()
	inner := &fakeClient{}
	cache := newCache()
	c := NewCachedGitClient(inner, cache, "u:i")

	page1 := &domain.RepositoryOptions{Page: 1, Size: 20, Keyword: "foo"}

	// 首次回源，并按 keyword/page/size 缓存。
	if _, err := c.Repositories(ctx, page1); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 1 {
		t.Fatalf("inner.calls = %d, want 1", inner.calls)
	}
	if _, ok := cache.Get("u:i:page:foo:1:20"); !ok {
		t.Errorf("expected per-page cache under key %q", "u:i:page:foo:1:20")
	}

	// 同参数命中缓存。
	if _, err := c.Repositories(ctx, page1); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 1 {
		t.Errorf("same page should hit cache: inner.calls = %d, want 1", inner.calls)
	}

	// 不同 page / keyword / size 各自独立回源。
	variants := []*domain.RepositoryOptions{
		{Page: 2, Size: 20, Keyword: "foo"},
		{Page: 1, Size: 20, Keyword: "bar"},
		{Page: 1, Size: 50, Keyword: "foo"},
	}
	for i, v := range variants {
		if _, err := c.Repositories(ctx, v); err != nil {
			t.Fatal(err)
		}
		want := 2 + i
		if inner.calls != want {
			t.Errorf("variant %d should be a cache miss: inner.calls = %d, want %d", i, inner.calls, want)
		}
	}

	// 分页路径与全量路径 key 不冲突。
	if _, ok := cache.Get("u:i"); ok {
		t.Errorf("full-list key should not be populated by paginated calls")
	}
}

func TestCachedRepositories_PageFlush(t *testing.T) {
	ctx := context.Background()
	inner := &fakeClient{}
	cache := newCache()
	c := NewCachedGitClient(inner, cache, "u:i")

	opts := &domain.RepositoryOptions{Page: 1, Size: 20, Keyword: "foo"}
	if _, err := c.Repositories(ctx, opts); err != nil {
		t.Fatal(err)
	}
	// flush 仅对当前请求生效，重新回源。
	flushed := &domain.RepositoryOptions{Page: 1, Size: 20, Keyword: "foo", Flush: true}
	if _, err := c.Repositories(ctx, flushed); err != nil {
		t.Fatal(err)
	}
	if inner.calls != 2 {
		t.Errorf("flush on a page should re-fetch: inner.calls = %d, want 2", inner.calls)
	}
}
