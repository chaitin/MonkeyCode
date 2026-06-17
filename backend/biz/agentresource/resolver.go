package agentresource

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// defaultPresignTTL is the lifetime baked into skill / plugin presigned GET
// URLs we hand off to the codingmatrix agent. 24h is the ceiling on task
// VM lifetime, so any URL minted at task-create time stays usable for the
// entire task run.
const defaultPresignTTL = 24 * time.Hour

// ObjectStore is the minimal read-only surface the Resolver needs from an
// object store. *pkg/oss.Client implements this implicitly, but the interface
// is declared here so tests can inject in-memory fakes without pulling AWS
// SDK dependencies.
type ObjectStore interface {
	GetObject(ctx context.Context, key string) (io.ReadCloser, error)
	// PresignGet returns a presigned GET URL for the given full object key.
	// Used by SkillRefs / PluginRefs so the dispatch path can hand the URL
	// down to the codingmatrix agent (which fetches + unzips in-VM)
	// instead of round-tripping the zip through the gRPC PushTasks call.
	PresignGet(ctx context.Context, key string, expires time.Duration) (string, error)
	// PutFile writes a zip artifact under {prefix}/{basename(filename)}. Used
	// by the team-admin bare-repo upload flow (biz/team/usecase) so a single
	// abstraction owns all skill/plugin OSS writes,无 oss SDK 直接耦合。
	PutFile(ctx context.Context, prefix, filename string, body io.Reader) error
}

// ResolverInterface is the abstract surface consumed by the task dispatch
// path. It exists so callers (notably the task usecase) can depend on a
// minimal contract and inject fakes in tests.
type ResolverInterface interface {
	Rules(ctx context.Context) ([]MaterializedRule, error)
	Skills(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error)
	Plugins(ctx context.Context, userSelectedIDs []uuid.UUID) ([]MaterializedAsset, error)
	// SkillRefs / PluginRefs are the presigned-URL counterparts used by
	// the AgentResources dispatch path. The legacy MaterializedAsset
	// methods stay so callers we have not migrated keep compiling.
	SkillRefs(ctx context.Context, userSelectedIDs []uuid.UUID) ([]SkillRef, error)
	PluginRefs(ctx context.Context, userSelectedIDs []uuid.UUID) ([]PluginRef, error)

	// Scoped variants for the three-tier picker / dispatch path. Apply
	// ScopeFilter at the SQL layer and name-based override (user > team >
	// global) at the projection step. Enabled=false rows are excluded
	// (dispatch should never carry disabled skills/plugins,即使 force_delivery)。
	SkillRefsScoped(ctx context.Context, sel SkillSelection) ([]SkillRef, error)
	PluginRefsScoped(ctx context.Context, sel SkillSelection) ([]PluginRef, error)
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

// SkillRefs is the presigned-URL alternative to Skills. The repo query and
// {user-selected ∪ force-delivery} union logic are identical; only the
// per-skill payload differs: instead of downloading + unzipping in-process,
// the resolver presigns the S3 key so the codingmatrix agent fetches the
// zip itself inside the task VM.
//
// Per-skill presign failures are warn-logged and skipped to preserve the
// "one bad skill never breaks dispatch" contract that Skills() upholds.
func (r *Resolver) SkillRefs(ctx context.Context, userSelectedIDs []uuid.UUID) ([]SkillRef, error) {
	skills, err := r.repo.ListActiveSkills(ctx, userSelectedIDs)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills: %w", err)
	}
	out := make([]SkillRef, 0, len(skills))
	for _, s := range skills {
		url, err := r.objstore.PresignGet(ctx, s.S3Key, defaultPresignTTL)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip skill, presign failed",
				slog.String("skill", s.Name),
				slog.String("s3_key", s.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		r.logger.InfoContext(ctx, "agentresource: skill ref resolved",
			slog.String("skill", s.Name),
			slog.String("version", s.Version),
			slog.String("s3_key", s.S3Key),
			slog.String("zip_url", url),
		)
		out = append(out, SkillRef{
			Name:    s.Name,
			Version: s.Version,
			ZipURL:  url,
		})
	}
	return out, nil
}

// PluginRefs mirrors SkillRefs for plugins and additionally carries the
// plugin entry filename — the mcai-backend task dispatcher needs that to
// patch the opencode.json `plugin` array with the right file:// URL.
func (r *Resolver) PluginRefs(ctx context.Context, userSelectedIDs []uuid.UUID) ([]PluginRef, error) {
	plugins, err := r.repo.ListActivePlugins(ctx, userSelectedIDs)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins: %w", err)
	}
	out := make([]PluginRef, 0, len(plugins))
	for _, p := range plugins {
		url, err := r.objstore.PresignGet(ctx, p.S3Key, defaultPresignTTL)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip plugin, presign failed",
				slog.String("plugin", p.Name),
				slog.String("s3_key", p.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		r.logger.InfoContext(ctx, "agentresource: plugin ref resolved",
			slog.String("plugin", p.Name),
			slog.String("version", p.Version),
			slog.String("entry", p.Entry),
			slog.String("s3_key", p.S3Key),
			slog.String("zip_url", url),
		)
		out = append(out, PluginRef{
			Name:          p.Name,
			Version:       p.Version,
			ZipURL:        url,
			EntryFilename: p.Entry,
		})
	}
	return out, nil
}

// SkillRefsScoped is the three-tier-aware counterpart of SkillRefs. The repo
// query already enforces enabled=true + ScopeFilter + name override.
func (r *Resolver) SkillRefsScoped(ctx context.Context, sel SkillSelection) ([]SkillRef, error) {
	skills, err := r.repo.ListActiveSkillsScoped(ctx, sel)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills scoped: %w", err)
	}
	out := make([]SkillRef, 0, len(skills))
	for _, s := range skills {
		url, err := r.objstore.PresignGet(ctx, s.S3Key, defaultPresignTTL)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip skill (scoped), presign failed",
				slog.String("skill", s.Name),
				slog.String("s3_key", s.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		out = append(out, SkillRef{Name: s.Name, Version: s.Version, ZipURL: url})
	}
	return out, nil
}

// PluginRefsScoped is the three-tier-aware counterpart of PluginRefs.
func (r *Resolver) PluginRefsScoped(ctx context.Context, sel SkillSelection) ([]PluginRef, error) {
	plugins, err := r.repo.ListActivePluginsScoped(ctx, sel)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins scoped: %w", err)
	}
	out := make([]PluginRef, 0, len(plugins))
	for _, p := range plugins {
		url, err := r.objstore.PresignGet(ctx, p.S3Key, defaultPresignTTL)
		if err != nil {
			r.logger.WarnContext(ctx, "agentresource: skip plugin (scoped), presign failed",
				slog.String("plugin", p.Name),
				slog.String("s3_key", p.S3Key),
				slog.Any("err", err),
			)
			continue
		}
		out = append(out, PluginRef{
			Name:          p.Name,
			Version:       p.Version,
			ZipURL:        url,
			EntryFilename: p.Entry,
		})
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
