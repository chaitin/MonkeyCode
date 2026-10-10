package resourceimport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	Pool    *pgxpool.Pool
	Storage resource.Storage
}

func NewService(pool *pgxpool.Pool, storage resource.Storage) *Service {
	return &Service{Pool: pool, Storage: storage}
}

type Options struct {
	AcceptNormalization bool              `json:"accept_normalization"`
	ConfirmFinal        bool              `json:"confirm_final"`
	AuthorizationModes  map[string]string `json:"authorization_modes,omitempty"`
}

type Change struct {
	Type       string   `json:"type"`
	Slug       string   `json:"slug"`
	Name       string   `json:"name"`
	Action     string   `json:"action"`
	ResourceID string   `json:"resource_id,omitempty"`
	Revision   int64    `json:"revision,omitempty"`
	AppliedSHA string   `json:"applied_sha256,omitempty"`
	SourceSHA  string   `json:"source_sha256,omitempty"`
	StoredSHA  string   `json:"storage_sha256,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`
}

type Preview struct {
	Publisher       string   `json:"publisher"`
	ReleaseID       string   `json:"release_id"`
	Version         int64    `json:"version"`
	PackageSHA256   string   `json:"package_sha256"`
	PlanDigest      string   `json:"plan_digest"`
	Changes         []Change `json:"changes"`
	IgnoredStatic   []string `json:"ignored_static"`
	RequiresConfirm bool     `json:"requires_confirmation"`
	AlreadyImported bool     `json:"already_imported"`
}

type binding struct {
	Slug       string     `json:"slug"`
	Type       string     `json:"resource_type"`
	ID         string     `json:"resource_id"`
	SourceSHA  string     `json:"source_sha256"`
	AppliedSHA string     `json:"applied_sha256"`
	RetiredAt  *time.Time `json:"retired_at"`
	Retired    bool       `json:"-"`
}

func bindings(ctx context.Context, q resource.Queryer, publisher string) (map[string]binding, error) {
	items, err := sqlc.New(q).ListImportBindings(ctx, publisher)
	if err != nil {
		return nil, err
	}
	out := map[string]binding{}
	for _, data := range items {
		var b binding
		if err = json.Unmarshal(data, &b); err != nil {
			return nil, err
		}
		b.Retired = b.RetiredAt != nil
		out[b.Slug] = b
	}
	return out, nil
}

func target(ctx context.Context, q resource.Queryer, b binding) (resource.Object, error) {
	data, err := sqlc.New(q).GetImportTarget(ctx, sqlc.GetImportTargetParams{Column1: b.Type, Column2: b.ID})
	if err != nil {
		return nil, err
	}
	var out resource.Object
	if err = json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	if out.String("ownership_type") != "system" {
		return nil, fmt.Errorf("被导入资源所有权异常: %s", b.ID)
	}
	return out, nil
}

type desired struct {
	Kind, Slug, Name, Source, StoredSHA string
	Fields                              resource.Object
	Warnings                            []string
}

func desiredItems(r Resources, opts Options, existing map[string]binding, ctx context.Context, q resource.Queryer) ([]desired, error) {
	out := make([]desired, 0, len(r.Skills)+len(r.Rules)+len(r.Connectors)+len(r.Experts))
	for _, s := range r.Skills {
		warning := slices.Clone(s.Normalizations)
		out = append(out, desired{Kind: "skill", Slug: s.Entry.Slug, Name: s.Entry.Name, Source: s.SourceSHA, StoredSHA: "sha256:" + s.Package.SHA, Warnings: warning,
			Fields: resource.Object{"name": s.Package.Name, "description": s.Package.Description, "file_tree_sha256": fileHash(s.Package.Files), "name_i18n": s.Entry.NameI18n, "description_i18n": s.Entry.DescriptionI18n}})
	}
	for _, r := range r.Rules {
		source := r.Entry.SHA256
		if source == "" {
			source = resource.Hash(r.Content)
		}
		out = append(out, desired{Kind: "rule", Slug: r.Entry.Slug, Name: r.Entry.Name, Source: source,
			Fields: resource.Object{"name": r.Entry.Name, "content": r.Content, "name_i18n": r.Entry.NameI18n, "description_i18n": r.Entry.DescriptionI18n}})
	}
	for _, c := range r.Connectors {
		method, mode := "", "none"
		switch c.Auth.Mode {
		case "header":
			method, mode = "http_header", "independent"
		case "oauth":
			method, mode = "oauth", "independent"
		}
		if raw := opts.AuthorizationModes[c.Entry.Slug]; raw != "" {
			if method == "" || (raw != "independent" && raw != "centralized") {
				return nil, fmt.Errorf("连接器认证归属无效: %s", c.Entry.Slug)
			}
			mode = raw
		} else if old, ok := existing[c.Entry.Slug]; ok && old.Type == "connector" {
			current, err := target(ctx, q, old)
			if err != nil {
				return nil, err
			}
			mode = current.String("authorization_mode")
		}
		out = append(out, desired{Kind: "connector", Slug: c.Entry.Slug, Name: c.Entry.Name, Source: c.Entry.SHA256,
			Fields: resource.Object{"name": c.Entry.Name, "url": c.Config.URL, "timeout_ms": c.Config.TimeoutMs,
				"auth_header_name": c.Auth.Header, "authorization_mode": mode, "authorization_method": method,
				"oauth_mode": map[bool]string{true: "dynamic", false: ""}[method == "oauth"], "oauth_scopes": strings.Join(strings.Fields(c.OAuth.Scope), " "),
				"name_i18n": c.Entry.NameI18n, "description_i18n": c.Entry.DescriptionI18n}})
	}
	for _, e := range r.Experts {
		skills, rules, connectors := slices.Clone(e.Skills), slices.Clone(e.Rules), slices.Clone(e.Connectors)
		slices.Sort(skills)
		slices.Sort(rules)
		slices.Sort(connectors)
		out = append(out, desired{Kind: "expert", Slug: e.Entry.Slug, Name: e.Entry.Name, Source: e.Entry.SHA256,
			Fields: resource.Object{"name": e.Entry.Name, "prompt": e.Prompt, "avatar_sha256": digest(e.Avatar),
				"skills": skills, "rules": rules, "connectors": connectors,
				"name_i18n": e.Entry.NameI18n, "description_i18n": e.Entry.DescriptionI18n}})
	}
	for slug := range opts.AuthorizationModes {
		if _, ok := r.Connectors[slug]; !ok {
			return nil, fmt.Errorf("认证归属指定了未知的连接器: %s", slug)
		}
	}
	slices.SortFunc(out, func(a, b desired) int { return strings.Compare(a.Slug, b.Slug) })
	return out, nil
}

func checkReferences(ctx context.Context, q resource.Queryer, b binding, present map[string]bool, r Resources, bindings map[string]binding) error {
	if b.Type != "rule" && b.Type != "skill" && b.Type != "connector" {
		return nil
	}
	ids, err := sqlc.New(q).ListImportReferences(ctx, sqlc.ListImportReferencesParams{Column1: b.Type, Column2: b.ID})
	if err != nil {
		return err
	}
	for _, id := range ids {
		needed := false
		for slug, expert := range r.Experts {
			bound, ok := bindings[slug]
			if !ok || bound.Type != "expert" || bound.ID != id {
				continue
			}
			if !present[slug] {
				break
			}
			switch b.Type {
			case "skill":
				needed = slices.Contains(expert.Skills, b.Slug)
			case "rule":
				needed = slices.Contains(expert.Rules, b.Slug)
			case "connector":
				needed = slices.Contains(expert.Connectors, b.Slug)
			}
			break
		}
		if needed {
			return fmt.Errorf("资源 %s 仍被保留的 Expert %s 引用", b.Slug, id)
		}
		local := true
		for _, old := range bindings {
			if old.ID == id && old.Type == "expert" {
				local = false
				break
			}
		}
		if local {
			return fmt.Errorf("资源 %s 仍被其他 Expert %s 引用", b.Slug, id)
		}
	}
	return nil
}

func (s *Service) Evaluate(ctx context.Context, q resource.Queryer, p Package, r Resources, opts Options, packageSHA string) (Preview, error) {
	result := Preview{Publisher: p.Release.Publisher.Name, ReleaseID: p.Release.ReleaseID, Version: p.Release.Version,
		PackageSHA256: packageSHA, Changes: []Change{}, IgnoredStatic: []string{}}
	for _, a := range p.Manifest.StaticAssets {
		prefix := "static/" + a.Slug + "/"
		for name := range p.Files {
			if strings.HasPrefix(name, prefix) {
				result.IgnoredStatic = append(result.IgnoredStatic, name)
			}
		}
	}
	slices.Sort(result.IgnoredStatic)
	last, err := sqlc.New(q).GetLatestImport(ctx, result.Publisher)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if err == nil {
		if result.Version == last.Version && result.ReleaseID == last.ReleaseID && p.Manifest.ManifestSHA256 == last.ManifestSha256 {
			result.AlreadyImported = true
		} else if result.Version <= last.Version || result.ReleaseID == last.ReleaseID {
			return result, fmt.Errorf("publisher %s 的 release 版本或标识冲突", result.Publisher)
		}
	}
	current, err := bindings(ctx, q, result.Publisher)
	if err != nil {
		return result, err
	}
	items, err := desiredItems(r, opts, current, ctx, q)
	if err != nil {
		return result, err
	}
	present := map[string]bool{}
	for _, item := range items {
		present[item.Slug] = true
		change := Change{Type: item.Kind, Slug: item.Slug, Name: item.Name, SourceSHA: item.Source, StoredSHA: item.StoredSHA, AppliedSHA: resource.Hash(item.Fields), Warnings: item.Warnings}
		if b, ok := current[item.Slug]; ok {
			if b.Type != item.Kind {
				return result, fmt.Errorf("资源 %s 跨类型冲突", item.Slug)
			}
			obj, err := target(ctx, q, b)
			if err != nil {
				return result, fmt.Errorf("导入资源 %s 目标不存在或异常: %w", item.Slug, err)
			}
			change.ResourceID, change.Revision = b.ID, obj.Int("revision")
			switch {
			case b.Retired:
				if obj.Bool("enabled") {
					return result, fmt.Errorf("退役资源 %s 状态异常", item.Slug)
				}
				change.Action = "restore"
				change.Warnings = append(change.Warnings, "恢复会让仍有效的旧授权及凭证重新生效")
			case b.AppliedSHA == change.AppliedSHA:
				change.Action = "skip"
			default:
				change.Action = "update"
			}
		} else {
			change.Action = "create"
		}
		if item.Kind == "skill" && len(item.Warnings) > 0 || change.Action == "restore" {
			result.RequiresConfirm = true
		}
		result.Changes = append(result.Changes, change)
	}
	for slug, b := range current {
		if present[slug] || b.Retired {
			continue
		}
		obj, err := target(ctx, q, b)
		if err != nil {
			return result, fmt.Errorf("将退役资源 %s 目标异常: %w", slug, err)
		}
		if v, ok := obj["enabled"].(bool); !ok || !v {
			return result, fmt.Errorf("将退役资源 %s 启停状态异常", slug)
		}
		if err := checkReferences(ctx, q, b, present, r, current); err != nil {
			return result, err
		}
		result.Changes = append(result.Changes, Change{Type: b.Type, Slug: slug, Name: obj.String("name"), Action: "retire",
			ResourceID: b.ID, Revision: obj.Int("revision"), SourceSHA: b.SourceSHA, AppliedSHA: b.AppliedSHA})
		result.RequiresConfirm = true
	}
	slices.SortFunc(result.Changes, func(a, b Change) int { return strings.Compare(a.Slug, b.Slug) })
	result.PlanDigest = resource.Hash(resource.Object{"publisher": result.Publisher, "release_id": result.ReleaseID,
		"version": result.Version, "package_sha256": packageSHA, "authorization_modes": opts.AuthorizationModes, "changes": result.Changes, "ignored_static": result.IgnoredStatic})
	return result, nil
}
