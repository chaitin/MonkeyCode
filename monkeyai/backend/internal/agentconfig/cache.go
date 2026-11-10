package agentconfig

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type catalogVersion struct {
	State      string
	ValidUntil float64
}

func (r *Resources) version(ctx context.Context, q resource.Queryer, kind string) (catalogVersion, error) {
	queries := sqlc.New(q)
	switch kind {
	case "rules":
		row, err := queries.CatalogRulesVersion(ctx)
		return catalogVersion(row), err
	case "skills":
		row, err := queries.CatalogSkillsVersion(ctx)
		return catalogVersion(row), err
	case "experts":
		row, err := queries.CatalogExpertsVersion(ctx, float64(time.Now().UnixNano())/1e9)
		return catalogVersion(row), err
	case "connectors":
		row, err := queries.CatalogConnectorsVersion(ctx, float64(time.Now().UnixNano())/1e9)
		return catalogVersion(row), err
	default:
		return catalogVersion{}, resource.NotFound
	}
}

type catalogETag struct {
	state   string
	etag    string
	expires time.Time
}

type catalogCache struct {
	mu      sync.Mutex
	entries map[string]catalogETag
}

func catalogKey(user string, req *http.Request) string {
	return user + "\x00" + req.Method + "\x00" + req.URL.Path + "?" + req.URL.Query().Encode()
}

func (c *catalogCache) get(key, state string, now time.Time) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return "", false
	}
	if entry.state != state || !now.Before(entry.expires) {
		delete(c.entries, key)
		return "", false
	}
	return entry.etag, true
}

func (c *catalogCache) put(key string, version catalogVersion, etag string, now time.Time) {
	if len(key) > 4096 || etag == "" {
		return
	}
	expires := now.Add(time.Minute)
	if version.ValidUntil > 0 {
		// 向下取整，避免跨过无刷新令牌凭证的实际过期时间。
		if deadline := time.Unix(int64(version.ValidUntil), 0); deadline.Before(expires) {
			expires = deadline
		}
	}
	if !now.Before(expires) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]catalogETag)
	}
	if _, exists := c.entries[key]; !exists && len(c.entries) >= 512 {
		for candidate := range c.entries {
			delete(c.entries, candidate)
			break
		}
	}
	c.entries[key] = catalogETag{state: version.State, etag: etag, expires: expires}
}
