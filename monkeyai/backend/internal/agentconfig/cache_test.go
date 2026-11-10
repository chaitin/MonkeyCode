package agentconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type catalogTrace struct {
	mu    sync.Mutex
	names []string
}

func (c *catalogTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	fields := strings.Fields(data.SQL)
	if len(fields) > 0 {
		name := fields[0]
		if len(fields) > 2 && name == "--" {
			name = fields[2]
		}
		c.mu.Lock()
		c.names = append(c.names, name)
		c.mu.Unlock()
	}
	return ctx
}

func (*catalogTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (c *catalogTrace) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.names = nil
}

func (c *catalogTrace) counts() map[string]int {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := map[string]int{}
	for _, name := range c.names {
		out[name]++
	}
	return out
}

func catalogHandler(t testing.TB, r *Resources, users ...string) http.Handler {
	t.Helper()
	for _, user := range users {
		hash := sha256.Sum256([]byte(user))
		catalogExec(t, r, "INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'catalog-test',$2,$3,now()+interval '1 hour',now()+interval '2 hours')",
			user, hex.EncodeToString(hash[:]), "refresh-"+user)
	}
	router := chi.NewRouter()
	router.Use(identity.NewService(r.store.Pool, nil, "http://localhost:8080").RequireAgent)
	r.RegisterAgent(router)
	return router
}

func catalogRead(t testing.TB, handler http.Handler, user, path, etag string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Authorization", "Bearer "+user)
	req.Header.Set("If-None-Match", etag)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 && w.Code != 304 {
		t.Fatalf("%s: status=%d body=%s", path, w.Code, w.Body.String())
	}
	return w
}

func TestCatalogFast304AndQueryIsolation(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	handler := catalogHandler(t, r, user, other)
	trace := r.store.Pool.Config().ConnConfig.Tracer.(*catalogTrace)
	for _, path := range []string{"/rules", "/skills?page_size=2", "/experts", "/connectors", "/skills/tags", "/experts/tags", "/connectors/tags"} {
		first := catalogRead(t, handler, user, path, "")
		trace.reset()
		cached := catalogRead(t, handler, user, path, "W/"+first.Header().Get("ETag"))
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatalf("%s 未命中条件缓存: %d %s", path, cached.Code, cached.Body.String())
		}
		for name, n := range trace.counts() {
			if strings.HasPrefix(name, "Catalog") && !strings.HasSuffix(name, "Version") {
				t.Fatalf("304 重建了目录: %s=%d", name, n)
			}
		}
	}
	first := catalogRead(t, handler, user, "/skills?page_size=2", "")
	etag := first.Header().Get("ETag")
	for _, query := range []string{"page=2&page_size=2", "owner=mine&page_size=2", "q=missing&page_size=2", "tag_id=invalid&page_size=2"} {
		if got := catalogRead(t, handler, user, "/skills?"+query, etag); got.Code != 200 {
			t.Fatalf("不同筛选或分页复用了旧 ETag: %s", query)
		}
	}
	trace.reset()
	catalogRead(t, handler, other, "/skills?page_size=2", etag)
	if trace.counts()["CatalogSkillsPage"] != 1 {
		t.Fatal("不同用户复用了未按权限重建的目录")
	}
}

func TestCatalogETagInvalidation(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	handler := catalogHandler(t, r, user)
	path := "/skills?page_size=2"
	mutations := []struct {
		name string
		sql  string
		args []any
	}{
		{"标签改名", "UPDATE tags SET name='renamed' WHERE id='20000000-0000-0000-0000-000000000001'", nil},
		{"所有者改名", "UPDATE users SET name='renamed' WHERE id=$1", []any{user}},
		{"直接撤权", "DELETE FROM resource_access_grants WHERE resource_type='skill' AND resource_id='10000000-0000-0000-0000-000000000003'", nil},
		{"移出分组", "UPDATE group_users SET removed_at=now() WHERE user_id=$1", []any{user}},
		{"重新加入分组", "UPDATE group_users SET removed_at=NULL WHERE user_id=$1", []any{user}},
		{"分组层级变更", "UPDATE groups SET parent_id=NULL WHERE name='child'", nil},
		{"计费权限变更", "INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing','{\"charging_mode\":\"remote\"}',$1)", []any{user}},
		{"云身份恢复系统权限", "INSERT INTO user_identities(user_id,provider,issuer,provider_subject) VALUES($1,'baizhiyun','test','test')", []any{user}},
		{"资源停用", "UPDATE skills SET enabled=false WHERE id='10000000-0000-0000-0000-000000000001'", nil},
		{"资源删除", "DELETE FROM skills WHERE id='10000000-0000-0000-0000-000000000002'", nil},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			before := catalogRead(t, handler, user, path, "")
			catalogExec(t, r, mutation.sql, mutation.args...)
			after := catalogRead(t, handler, user, path, before.Header().Get("ETag"))
			if after.Code != 200 || after.Header().Get("ETag") == before.Header().Get("ETag") {
				t.Fatalf("变更后仍命中旧目录: %s", mutation.name)
			}
		})
	}
}

func TestCatalogCredentialRevocationInvalidatesETag(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	connector := "10000000-0000-0000-0000-000000000001"
	catalogExec(t, r, "UPDATE connectors SET authorization_mode='independent',authorization_method='http_header' WHERE id=$1", connector)
	for _, owner := range []string{user, other} {
		catalogExec(t, r, "INSERT INTO connector_credentials(connector_id,user_id,http_headers,config_revision) VALUES($1,$2,'{\"X-Test\":\"secret\"}',1)", connector, owner)
	}
	catalogExec(t, r, "INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('connector',$1,$2,'read_only',$3)", connector, other, user)
	handler := catalogHandler(t, r, user, other)
	before := catalogRead(t, handler, user, "/connectors", "")
	otherBefore := catalogRead(t, handler, other, "/connectors", "")
	catalogExec(t, r, "UPDATE connector_credentials SET revoked_at=now() WHERE connector_id=$1 AND user_id=$2", connector, user)
	after := catalogRead(t, handler, user, "/connectors", before.Header().Get("ETag"))
	if after.Code != 200 || after.Header().Get("ETag") == before.Header().Get("ETag") {
		t.Fatal("凭证撤销后仍下发旧目录")
	}
	if got := catalogRead(t, handler, other, "/connectors", otherBefore.Header().Get("ETag")); got.Code != 304 {
		t.Fatal("其他用户的公开目录发生了变化")
	}
}

func TestCatalogVersionUsesReadSnapshot(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	tx, err := r.transaction(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	before, err := r.version(t.Context(), tx, "skills")
	if err != nil {
		t.Fatal(err)
	}
	catalogExec(t, r, "UPDATE tags SET name='changed-'||id::text")
	same, err := r.version(t.Context(), tx, "skills")
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := r.version(t.Context(), r.store.Pool, "skills")
	if err != nil {
		t.Fatal(err)
	}
	if same.State != before.State || fresh.State == before.State {
		t.Fatal("版本校验未遵循目录读取的事务快照")
	}
}

func TestCatalogVersionTracksOAuthDeadline(t *testing.T) {
	r, user, _ := catalogDatabase(t)
	connector := "10000000-0000-0000-0000-000000000001"
	catalogExec(t, r, "INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,'oauth','https://example.com/mcp','independent','oauth')", connector, user)
	catalogExec(t, r, "INSERT INTO connector_credentials(connector_id,user_id,config_revision,oauth_access_token,oauth_expires_at) VALUES($1,$2,1,'secret',now()+interval '10 seconds')", connector, user)
	version, err := r.version(t.Context(), r.store.Pool, "connectors")
	if err != nil {
		t.Fatal(err)
	}
	if version.ValidUntil <= float64(time.Now().Unix()) {
		t.Fatal("版本校验没有返回无刷新令牌凭证的过期边界")
	}
	catalogExec(t, r, "UPDATE connector_credentials SET oauth_expires_at=now()-interval '10 seconds'")
	earlierClock, err := sqlc.New(r.store.Pool).CatalogConnectorsVersion(t.Context(), float64(time.Now().Add(-time.Minute).Unix()))
	if err != nil || earlierClock.ValidUntil == 0 {
		t.Fatalf("到期边界使用了数据库时钟而非认证时钟: %v", err)
	}
	catalogExec(t, r, "UPDATE connector_credentials SET oauth_refresh_token='refresh'")
	refreshable, err := r.version(t.Context(), r.store.Pool, "connectors")
	if err != nil {
		t.Fatal(err)
	}
	if refreshable.ValidUntil != 0 {
		t.Fatal("可刷新令牌的时间变化不应使公开目录定时失效")
	}
}

func TestCatalogCacheConcurrent(t *testing.T) {
	var cache catalogCache
	var workers sync.WaitGroup
	now := time.Now()
	for worker := range 16 {
		workers.Go(func() {
			for i := range 32 {
				key := string(rune('a'+worker)) + strings.Repeat("x", i)
				cache.put(key, catalogVersion{State: "state"}, key, now)
				if got, ok := cache.get(key, "state", now); ok && got != key {
					t.Errorf("并发缓存混入其他查询: got=%q want=%q", got, key)
				}
			}
		})
	}
	workers.Wait()
}

func TestCatalogCacheDeadlineAndCapacity(t *testing.T) {
	var cache catalogCache
	now := time.Unix(2000000000, 0)
	version := catalogVersion{State: "state", ValidUntil: float64(now.Unix() + 5)}
	cache.put("key", version, "etag", now)
	if _, ok := cache.get("key", "state", now.Add(4*time.Second)); !ok {
		t.Fatal("有效期内未命中缓存")
	}
	if _, ok := cache.get("key", "state", now.Add(5*time.Second)); ok {
		t.Fatal("凭证过期后仍命中缓存")
	}
	version.ValidUntil = 0
	cache.put("key", version, "etag", now)
	if _, ok := cache.get("key", "changed", now); ok {
		t.Fatal("状态变更后仍命中缓存")
	}
	cache.put("key", version, "etag", now)
	if _, ok := cache.get("key", "state", now.Add(time.Minute)); ok {
		t.Fatal("缓存超过最大保留时间")
	}
	for i := range 600 {
		cache.put(strings.Repeat("x", i), version, "etag", now)
	}
	if len(cache.entries) != 512 {
		t.Fatalf("缓存未限制容量: %d", len(cache.entries))
	}
	cache.put(strings.Repeat("y", 4097), version, "etag", now)
	if len(cache.entries) != 512 {
		t.Fatal("超长查询键进入缓存")
	}
}
