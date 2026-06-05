// Package agentresource — DI wiring for the agent-resource read-only stack.
//
// The Repo / Resolver pair is consumed by:
//   - biz/task/usecase (rule + skill + plugin injection into ConfigFile slice)
//   - biz/skill/handler/v1 (/api/v1/skills picker)
//   - biz/plugin/handler/v1 (/api/v1/plugins picker)
package agentresource

import (
	"context"
	"log/slog"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/oss"
)

// ProvideAgentResource 注册 agentresource 模块。oss.Client 仅在 ObjectStorage
// 已启用时构造；未启用时 Resolver 会拿到 nil ObjectStore，调用 Skills/Plugins
// 时各自返回的 fetch 错误会被 resolver 内部 warn-and-skip 掉，dispatch 不会失败。
func ProvideAgentResource(i *do.Injector) {
	do.Provide(i, func(i *do.Injector) (Repo, error) {
		return NewRepo(do.MustInvoke[*db.Client](i)), nil
	})

	do.Provide(i, func(i *do.Injector) (*oss.Client, error) {
		cfg := do.MustInvoke[*config.Config](i)
		logger := do.MustInvoke[*slog.Logger](i)

		// Primary: ObjectStorage block (shared with avatar/repo/spec/temp).
		if cfg.ObjectStorage.Enabled {
			opt := oss.S3Option{
				ForcePathStyle: cfg.ObjectStorage.ForcePathStyle,
				InitBucket:     cfg.ObjectStorage.InitBucket,
			}
			return oss.NewS3Compatible(context.Background(), cfg.ObjectStorage, opt)
		}

		// Fallback: aliyun.public_oss block — same shape mcai-backend +
		// admin-new use. Lets ops paste a single OSS block into all three
		// deploys rather than duplicating credentials.
		if pub := cfg.Aliyun.PublicOSS; pub.Bucket != "" && pub.Endpoint != "" {
			logger.Info("agentresource: ObjectStorage disabled, falling back to aliyun.public_oss",
				"endpoint", pub.Endpoint, "bucket", pub.Bucket)
			return oss.NewS3Compatible(context.Background(), config.ObjectStorageConfig{
				Enabled:         true,
				Endpoint:        pub.Endpoint,
				AccessEndpoint:  pub.AccessEndpoint,
				AccessKey:       pub.AccessKey,
				AccessKeySecret: pub.AccessKeySecret,
				Bucket:          pub.Bucket,
				Region:          pub.Region,
				// Aliyun OSS uses virtual-hosted style; not path style.
				ForcePathStyle: false,
				MaxSize:        pub.MaxSize,
			}, oss.S3Option{})
		}

		// Neither block configured — Resolver will downgrade to noopObjectStore.
		return nil, nil
	})

	do.Provide(i, func(i *do.Injector) (ResolverInterface, error) {
		repo := do.MustInvoke[Repo](i)
		client, _ := do.Invoke[*oss.Client](i)
		logger := do.MustInvoke[*slog.Logger](i)
		// *oss.Client 隐式实现 ObjectStore（有 GetObject(ctx, key) 方法）。
		// 当 client==nil 时 wrap 一个 nil store 即可；resolver fetch 时会
		// 走到 nil-deref 之前已被外层 err 捕获——但为避免 panic，统一在这
		// 里把 nil 显式包成 noopObjectStore。
		var store ObjectStore
		if client != nil {
			store = client
		} else {
			store = noopObjectStore{}
		}
		return NewResolver(repo, store, logger), nil
	})
}
