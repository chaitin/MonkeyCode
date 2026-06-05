package agentresource

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	"github.com/google/uuid"
)

// ObjectStore is the minimal read-only surface the Resolver needs from an
// object store. *pkg/oss.Client implements this implicitly, but the interface
// is declared here so tests can inject in-memory fakes without pulling AWS
// SDK dependencies.
type ObjectStore interface {
	GetObject(ctx context.Context, key string) (io.ReadCloser, error)
}

// ResolverInterface is the abstract surface consumed by the task dispatch
// path. It exists so callers (notably the task usecase) can depend on a
// minimal contract and inject fakes in tests.
type ResolverInterface interface {
	Rules(ctx context.Context) ([]MaterializedRule, error)
	Skills(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error)
	Plugins(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error)
}

// Resolver glues the read-only Repo together with the read-only ObjectStore.
// It is the single seam used by the task dispatch path to turn DB rows + S3
// keys into actual byte payloads.
//
// All methods are safe for concurrent use as long as the underlying Repo and
// ObjectStore implementations are; the resolver itself is stateless.
type Resolver struct {
	repo     Repo
	objstore ObjectStore
	logger   *slog.Logger
}

// NewResolver wires a Resolver. A nil logger falls back to slog.Default so
// the resolver is safe to construct without explicit wiring in tests.
func NewResolver(repo Repo, objstore ObjectStore, logger *slog.Logger) *Resolver {
	if logger == nil {
		logger = slog.Default()
	}
	return &Resolver{repo: repo, objstore: objstore, logger: logger}
}

// Rules materializes every active rule by reading content directly from the
// shared DB (the admin BFF writes rule content into agent_rule_versions.content;
// no S3 round-trip is involved for rules).
func (r *Resolver) Rules(ctx context.Context) ([]MaterializedRule, error) {
	rules, err := r.repo.ListActiveRules(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list rules: %w", err)
	}
	out := make([]MaterializedRule, 0, len(rules))
	for _, ru := range rules {
		out = append(out, MaterializedRule{Name: ru.Name, Content: ru.Content})
	}
	return out, nil
}

// Skills materializes the union of {userSelectedIDs} and force-delivery
// skills. Each skill's S3 object is expected to be a zip; per-skill failures
// (download, unzip, zip-bomb, zip-slip) are logged + skipped so a single bad
// skill never breaks the dispatch path.
func (r *Resolver) Skills(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error) {
	skills, err := r.repo.ListActiveSkills(ctx, userSelectedIDs)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills: %w", err)
	}
	out := make([]MaterializedAsset, 0, len(skills))
	for _, s := range skills {
		body, err := r.fetch(ctx, s.S3Key)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip skill, fetch failed",
				slog.String("skill", s.Name),
				slog.String("s3_key", s.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		files, err := unzipToMemory(body, DefaultUnzipLimits)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip skill, unzip failed",
				slog.String("skill", s.Name),
				slog.String("s3_key", s.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		r.logger.InfoContext(ctx, "agentresource: skill resolved",
			slog.String("skill", s.Name),
			slog.String("version", s.Version),
			slog.String("s3_key", s.S3Key),
			slog.Int("files", len(files)),
		)
		out = append(out, MaterializedAsset{Name: s.Name, Files: files})
	}
	return out, nil
}

// Plugins mirrors Skills but also carries the plugin entrypoint (already
// hoisted out of parsed_meta by the repo layer).
func (r *Resolver) Plugins(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error) {
	plugins, err := r.repo.ListActivePlugins(ctx, userSelectedIDs)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins: %w", err)
	}
	out := make([]MaterializedAsset, 0, len(plugins))
	for _, p := range plugins {
		body, err := r.fetch(ctx, p.S3Key)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip plugin, fetch failed",
				slog.String("plugin", p.Name),
				slog.String("s3_key", p.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		files, err := unzipToMemory(body, DefaultUnzipLimits)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip plugin, unzip failed",
				slog.String("plugin", p.Name),
				slog.String("s3_key", p.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		r.logger.InfoContext(ctx, "agentresource: plugin resolved",
			slog.String("plugin", p.Name),
			slog.String("version", p.Version),
			slog.String("entry", p.Entry),
			slog.String("s3_key", p.S3Key),
			slog.Int("files", len(files)),
		)
		out = append(out, MaterializedAsset{Name: p.Name, Entry: p.Entry, Files: files})
	}
	return out, nil
}

// fetch pulls a single object body fully into memory. The body is always
// closed before returning, even on error.
func (r *Resolver) fetch(ctx context.Context, key string) ([]byte, error) {
	rc, err := r.objstore.GetObject(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}
