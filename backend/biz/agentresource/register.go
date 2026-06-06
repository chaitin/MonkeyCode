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

// ProvideAgentResource wires the agent-resource module. The ObjectStore is
// picked from whichever bucket block is configured:
//
//   - object_storage.enabled = true  → AWS-SDK-v2 client (any S3-compatible
//     store: MinIO, RustFS, real AWS). Reuses the same client avatar / repo /
//     spec / temp uploads use, so single SDK in the binary.
//   - aliyun.public_oss.bucket set    → aliyun-oss-go-sdk client. AWS SDK's
//     SigV4 signer is incompatible with Aliyun OSS (SignatureDoesNotMatch +
//     bucket double-prefix in path-style URLs), so we wire a native client
//     just for this code path. Existing pkg/oss.Client is untouched; avatar
//     etc. still go through the AWS SDK path when object_storage is on.
//   - neither configured              → nil ObjectStore. Resolver downgrades
//     to noopObjectStore; fetch/presign each fail and the per-asset skip
//     pipeline keeps the task creating without rule/skill/plugin assets.
func ProvideAgentResource(i *do.Injector) {
	do.Provide(i, func(i *do.Injector) (Repo, error) {
		return NewRepo(do.MustInvoke[*db.Client](i)), nil
	})

	do.Provide(i, func(i *do.Injector) (ObjectStore, error) {
		cfg := do.MustInvoke[*config.Config](i)
		logger := do.MustInvoke[*slog.Logger](i)

		// Primary: ObjectStorage block — AWS-SDK-v2 client.
		if cfg.ObjectStorage.Enabled {
			opt := oss.S3Option{
				ForcePathStyle: cfg.ObjectStorage.ForcePathStyle,
				InitBucket:     cfg.ObjectStorage.InitBucket,
			}
			client, err := oss.NewS3Compatible(context.Background(), cfg.ObjectStorage, opt)
			if err != nil {
				return nil, err
			}
			return client, nil
		}

		// Fallback: aliyun.public_oss — native aliyun-oss-go-sdk client.
		if pub := cfg.Aliyun.PublicOSS; pub.Bucket != "" && pub.Endpoint != "" {
			logger.Info("agentresource: using aliyun.public_oss (native SDK)",
				"endpoint", pub.Endpoint, "bucket", pub.Bucket)
			client, err := oss.NewAliyunOSS(pub)
			if err != nil {
				return nil, err
			}
			return client, nil
		}

		// Neither block configured — Resolver downgrades to noopObjectStore.
		return noopObjectStore{}, nil
	})

	do.Provide(i, func(i *do.Injector) (ResolverInterface, error) {
		repo := do.MustInvoke[Repo](i)
		store := do.MustInvoke[ObjectStore](i)
		logger := do.MustInvoke[*slog.Logger](i)
		return NewResolver(repo, store, logger), nil
	})
}
