package resourceimport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	load := func(w http.ResponseWriter, r *http.Request) (Package, Resources, Options, string, error) {
		r.Body = http.MaxBytesReader(w, r.Body, MaxPackage+(1<<20))
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			return Package{}, Resources{}, Options{}, "", resource.Invalid("资源包上传格式或大小无效")
		}
		if r.MultipartForm != nil {
			defer func() {
				if err := r.MultipartForm.RemoveAll(); err != nil {
					slog.WarnContext(r.Context(), "清理导入临时文件失败", "error", err)
				}
			}()
		}
		file, _, err := r.FormFile("package")
		if err != nil {
			return Package{}, Resources{}, Options{}, "", resource.Invalid("缺少资源包文件")
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, MaxPackage+1))
		if err != nil || len(data) > MaxPackage {
			return Package{}, Resources{}, Options{}, "", resource.Invalid("资源包超过大小限制")
		}
		var options Options
		if value := r.FormValue("options"); value != "" {
			if err := json.Unmarshal([]byte(value), &options); err != nil {
				return Package{}, Resources{}, Options{}, "", resource.Invalid("导入选项无效")
			}
		}
		pkg, err := Parse(data)
		if err != nil {
			return Package{}, Resources{}, Options{}, "", resource.Invalid(err.Error())
		}
		items, err := ParseResources(pkg)
		if err != nil {
			return Package{}, Resources{}, Options{}, "", resource.Invalid(err.Error())
		}
		return pkg, items, options, digest(data), nil
	}
	router.Post("/resource-imports/preview", func(w http.ResponseWriter, r *http.Request) {
		pkg, items, options, sha, err := load(w, r)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		out, err := s.Evaluate(r.Context(), s.Pool, pkg, items, options, sha)
		if err != nil {
			resource.Fail(w, &resource.Error{Status: 409, Code: "import_conflict", Message: err.Error()})
			return
		}
		resource.JSON(w, http.StatusOK, out)
	})
	router.Post("/resource-imports", func(w http.ResponseWriter, r *http.Request) {
		pkg, items, options, sha, err := load(w, r)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if r.FormValue("package_sha256") != sha || r.FormValue("plan_digest") == "" || !options.ConfirmFinal {
			resource.Fail(w, resource.Invalid("必须先预览并确认本包是最终 Agent 资源集合"))
			return
		}
		out, err := s.Apply(r.Context(), pkg, items, options, sha, r.FormValue("plan_digest"))
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, http.StatusOK, out)
	})
	router.Get("/resource-imports", func(w http.ResponseWriter, r *http.Request) {
		rows, err := sqlc.New(s.Pool).ListImportHistory(r.Context())
		if err != nil {
			resource.Fail(w, err)
			return
		}
		list := []resource.Object{}
		for _, data := range rows {
			var item resource.Object
			if err = json.Unmarshal(data, &item); err != nil {
				resource.Fail(w, err)
				return
			}
			list = append(list, item)
		}
		resource.JSON(w, http.StatusOK, resource.Object{"items": list})
	})
	router.Get("/resource-imports/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if _, err := uuid.Parse(id); err != nil {
			resource.Fail(w, resource.NotFound)
			return
		}
		data, err := sqlc.New(s.Pool).GetImportHistory(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			resource.Fail(w, resource.NotFound)
			return
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		var result resource.Object
		if err = json.Unmarshal(data, &result); err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, http.StatusOK, result)
	})
}

func conflict(message string) error {
	return &resource.Error{Status: 409, Code: "import_conflict", Message: message}
}

func publisherLock(name string) int64 {
	h := fnv.New64a()
	h.Write([]byte(name))
	return int64(h.Sum64())
}

func (s *Service) lockBindings(ctx context.Context, tx pgx.Tx, publisher string) error {
	if _, err := sqlc.New(tx).LockImportPublisher(ctx, publisherLock(publisher)); err != nil {
		return err
	}
	current, err := bindings(ctx, tx, publisher)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(current))
	for slug := range current {
		keys = append(keys, slug)
	}
	slices.Sort(keys)
	for _, slug := range keys {
		b := current[slug]
		var lockErr error
		switch b.Type {
		case "skill":
			_, lockErr = sqlc.New(tx).LockImportSkill(ctx, b.ID)
		case "rule":
			_, lockErr = sqlc.New(tx).LockImportRule(ctx, b.ID)
		case "connector":
			_, lockErr = sqlc.New(tx).LockImportConnector(ctx, b.ID)
		case "expert":
			_, lockErr = sqlc.New(tx).LockImportExpert(ctx, b.ID)
		default:
			return fmt.Errorf("资源类型不支持: %s", b.Type)
		}
		if lockErr != nil {
			return fmt.Errorf("被导入资源 %s 已不存在: %w", slug, lockErr)
		}
	}
	return nil
}

func (s *Service) prepareObjects(ctx context.Context, p Preview, r Resources) (map[string]string, func(), error) {
	keys := map[string]string{}
	written := []string{}
	cleanup := func() {
		for _, key := range written {
			if err := s.Storage.Delete(context.WithoutCancel(ctx), key); err != nil {
				slog.WarnContext(ctx, "导入对象存储补偿失败", "key", key, "error", err)
			}
		}
	}
	for _, c := range p.Changes {
		if c.Action != "create" && c.Action != "update" && c.Action != "restore" {
			continue
		}
		if item, ok := r.Skills[c.Slug]; ok && c.Type == "skill" {
			if c.ResourceID != "" {
				currentSHA, err := sqlc.New(s.Pool).GetImportSkillSHA(ctx, c.ResourceID)
				if err != nil {
					cleanup()
					return nil, nil, err
				}
				if currentSHA == item.Package.SHA {
					continue
				}
			}
			key := "resource-import/skills/" + resource.ID() + ".zip"
			if err := s.Storage.Put(ctx, key, item.Package.Bytes, "application/zip"); err != nil {
				cleanup()
				return nil, nil, err
			}
			keys["skill:"+c.Slug], written = key, append(written, key)
		}
		if item, ok := r.Experts[c.Slug]; ok && c.Type == "expert" && len(item.Avatar) != 0 {
			key := "resource-import/experts/" + resource.ID() + ".webp"
			if err := s.Storage.Put(ctx, key, item.Avatar, "image/webp"); err != nil {
				cleanup()
				return nil, nil, err
			}
			keys["expert:"+c.Slug], written = key, append(written, key)
		}
	}
	return keys, cleanup, nil
}

func (s *Service) Apply(ctx context.Context, p Package, r Resources, opts Options, packageSHA, expectedDigest string) (Preview, error) {
	pre, err := s.Evaluate(ctx, s.Pool, p, r, opts, packageSHA)
	if err != nil {
		return pre, conflict(err.Error())
	}
	if pre.PlanDigest != expectedDigest {
		return pre, conflict("资源包或预览结果已变化，请重新预览")
	}
	if pre.AlreadyImported {
		return pre, nil
	}
	if pre.RequiresConfirm && !opts.AcceptNormalization {
		for _, c := range pre.Changes {
			if c.Type == "skill" && len(c.Warnings) != 0 {
				return pre, resource.Invalid("请确认技能 frontmatter 的规范化变更")
			}
		}
	}
	objects, cleanup, err := s.prepareObjects(ctx, pre, r)
	if err != nil {
		return pre, fmt.Errorf("预写资源包对象失败: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			cleanup()
		}
	}()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return pre, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	if err = s.lockBindings(ctx, tx, pre.Publisher); err != nil {
		return pre, err
	}
	locked, err := s.Evaluate(ctx, tx, p, r, opts, packageSHA)
	if err != nil {
		return pre, conflict(err.Error())
	}
	if locked.PlanDigest != expectedDigest {
		return pre, conflict("导入期间资源状态已变化，请重新预览")
	}
	actor, ok := identity.UserFromContext(ctx)
	if !ok || actor.Role != "admin" {
		return pre, resource.NotFound
	}
	importID := resource.ID()
	counts := map[string]int{"create": 0, "update": 0, "skip": 0, "retire": 0, "restore": 0, "ignored_static": len(pre.IgnoredStatic)}
	for _, c := range locked.Changes {
		counts[c.Action]++
	}
	if err = sqlc.New(tx).CreateImportBatch(ctx, payload(resource.Object{"id": importID, "publisher": pre.Publisher,
		"release_id": pre.ReleaseID, "version": pre.Version, "manifest_sha256": p.Manifest.ManifestSHA256,
		"actor_user_id": actor.ID, "result_counts": counts})); err != nil {
		return pre, err
	}
	ids := map[string]string{}
	for _, c := range locked.Changes {
		if c.Action == "retire" {
			continue
		}
		if c.ResourceID != "" {
			ids[c.Slug] = c.ResourceID
		} else {
			ids[c.Slug] = resource.ID()
		}
	}
	order := []string{"expert", "skill", "rule", "connector"}
	for _, kind := range order {
		for _, change := range locked.Changes {
			if change.Type != kind || change.Action != "retire" {
				continue
			}
			if err = applyRetirement(ctx, tx, pre.Publisher, importID, change); err != nil {
				return pre, err
			}
			if err = resource.Audit(ctx, tx, actor.ID, kind, change.ResourceID, "import_retire"); err != nil {
				return pre, err
			}
		}
	}
	order = []string{"skill", "rule", "connector", "expert"}
	for _, kind := range order {
		for _, change := range locked.Changes {
			if change.Type != kind || change.Action == "retire" {
				continue
			}
			id := ids[change.Slug]
			if change.Action != "skip" {
				if err = writeResource(ctx, tx, r, change, id, actor.ID, objects, ids, opts); err != nil {
					return pre, err
				}
				if err = resource.Audit(ctx, tx, actor.ID, kind, id, "import_"+change.Action); err != nil {
					return pre, err
				}
			}
			if err = sqlc.New(tx).UpsertImportBinding(ctx, payload(resource.Object{"publisher": pre.Publisher,
				"slug": change.Slug, "resource_type": kind, "resource_id": id,
				"source_sha256": change.SourceSHA, "applied_sha256": change.AppliedSHA, "last_import_id": importID})); err != nil {
				return pre, err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return pre, err
	}
	committed = true
	return locked, nil
}

func applyRetirement(ctx context.Context, tx pgx.Tx, publisher, importID string, change Change) error {
	queries := sqlc.New(tx)
	var err error
	switch change.Type {
	case "skill":
		err = queries.RetireImportSkill(ctx, change.ResourceID)
	case "rule":
		err = queries.RetireImportRule(ctx, change.ResourceID)
	case "connector":
		err = queries.RetireImportConnector(ctx, change.ResourceID)
	case "expert":
		err = queries.RetireImportExpert(ctx, change.ResourceID)
	default:
		return fmt.Errorf("资源类型不支持: %s", change.Type)
	}
	if err != nil {
		return err
	}
	return queries.RetireImportBinding(ctx, sqlc.RetireImportBindingParams{ImportID: importID, Publisher: publisher, Slug: change.Slug})
}

func description(values map[string]string) string {
	for _, lang := range []string{"en-US", "en", "zh-CN"} {
		if values[lang] != "" {
			return values[lang]
		}
	}
	return ""
}

func writeResource(ctx context.Context, tx pgx.Tx, r Resources, change Change, id, actor string, objects, ids map[string]string, opts Options) error {
	create := change.Action == "create"
	switch change.Type {
	case "skill":
		item := r.Skills[change.Slug]
		p := item.Package
		data := payload(resource.Object{"id": id, "actor_id": actor, "name": p.Name, "description": p.Description,
			"name_i18n": mapOrEmpty(item.Entry.NameI18n), "description_i18n": mapOrEmpty(item.Entry.DescriptionI18n),
			"package_file_name": change.Slug + ".zip", "package_s3_key": objects["skill:"+change.Slug],
			"package_size_bytes": len(p.Bytes), "package_sha256": p.SHA, "file_count": len(p.Files)})
		if create {
			return sqlc.New(tx).CreateImportSkill(ctx, data)
		}
		return sqlc.New(tx).UpdateImportSkill(ctx, data)
	case "rule":
		item := r.Rules[change.Slug]
		data := payload(resource.Object{"id": id, "actor_id": actor, "name": change.Name, "content": item.Content,
			"name_i18n": mapOrEmpty(item.Entry.NameI18n), "description_i18n": mapOrEmpty(item.Entry.DescriptionI18n)})
		if create {
			return sqlc.New(tx).CreateImportRule(ctx, data)
		}
		return sqlc.New(tx).UpdateImportRule(ctx, data)
	case "connector":
		return writeConnector(ctx, tx, r.Connectors[change.Slug], change, id, actor, opts)
	case "expert":
		item := r.Experts[change.Slug]
		desc := description(item.Entry.DescriptionI18n)
		queries := sqlc.New(tx)
		data := payload(resource.Object{"id": id, "actor_id": actor, "name": change.Name,
			"description": desc, "prompt": item.Prompt, "avatar_s3_key": objects["expert:"+change.Slug],
			"name_i18n": mapOrEmpty(item.Entry.NameI18n), "description_i18n": mapOrEmpty(item.Entry.DescriptionI18n)})
		if create {
			if err := queries.CreateImportExpert(ctx, data); err != nil {
				return err
			}
		} else {
			if err := queries.UpdateImportExpert(ctx, data); err != nil {
				return err
			}
			if err := queries.ClearImportExpertSkills(ctx, id); err != nil {
				return err
			}
			if err := queries.ClearImportExpertRules(ctx, id); err != nil {
				return err
			}
			if err := queries.ClearImportExpertConnectors(ctx, id); err != nil {
				return err
			}
		}
		for _, slug := range item.Skills {
			if ids[slug] == "" {
				return fmt.Errorf("专家依赖资源未写入: %s", slug)
			}
			if err := queries.LinkImportExpertSkill(ctx, sqlc.LinkImportExpertSkillParams{Column1: id, Column2: ids[slug]}); err != nil {
				return err
			}
		}
		for _, slug := range item.Rules {
			if ids[slug] == "" {
				return fmt.Errorf("专家依赖资源未写入: %s", slug)
			}
			if err := queries.LinkImportExpertRule(ctx, sqlc.LinkImportExpertRuleParams{Column1: id, Column2: ids[slug]}); err != nil {
				return err
			}
		}
		for _, slug := range item.Connectors {
			if ids[slug] == "" {
				return fmt.Errorf("专家依赖资源未写入: %s", slug)
			}
			if err := queries.LinkImportExpertConnector(ctx, sqlc.LinkImportExpertConnectorParams{Column1: id, Column2: ids[slug]}); err != nil {
				return err
			}
		}
		return nil
	}
	return fmt.Errorf("资源类型不支持: %s", change.Type)
}

func mapOrEmpty(value map[string]string) map[string]string {
	if value == nil {
		return map[string]string{}
	}
	return value
}

func payload(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}

func writeConnector(ctx context.Context, tx pgx.Tx, item Connector, change Change, id, actor string, opts Options) error {
	method, mode := "", "none"
	switch item.Auth.Mode {
	case "header":
		method, mode = "http_header", "independent"
	case "oauth":
		method, mode = "oauth", "independent"
	}
	var old resource.Object
	if change.Action != "create" {
		data, err := sqlc.New(tx).GetImportTarget(ctx, sqlc.GetImportTargetParams{Column1: "connector", Column2: id})
		if err != nil {
			return err
		}
		if err := json.Unmarshal(data, &old); err != nil {
			return err
		}
		if method != "" {
			mode = old.String("authorization_mode")
		}
	}
	if picked := opts.AuthorizationModes[change.Slug]; picked != "" {
		mode = picked
	}
	oauth := resource.Object{}
	if method == "oauth" {
		oauth["mode"], oauth["scopes"] = "dynamic", strings.Join(strings.Fields(item.OAuth.Scope), " ")
		if old.String("url") == item.Config.URL && old.String("authorization_method") == "oauth" {
			if previous, ok := old["oauth_config"].(map[string]any); ok {
				for key, value := range previous {
					if key != "scopes" {
						oauth[key] = value
					}
				}
			}
		}
	}
	data := resource.Object{"id": id, "actor_id": actor, "name": change.Name, "url": item.Config.URL,
		"authorization_mode": mode, "authorization_method": method, "oauth_config": oauth,
		"timeout_ms": item.Config.TimeoutMs, "auth_header_name": item.Auth.Header,
		"name_i18n": mapOrEmpty(item.Entry.NameI18n), "description_i18n": mapOrEmpty(item.Entry.DescriptionI18n)}
	if change.Action == "create" {
		return sqlc.New(tx).CreateImportConnector(ctx, payload(data))
	}
	var previousScopes string
	if oldConfig, ok := old["oauth_config"].(map[string]any); ok {
		previousScopes, _ = oldConfig["scopes"].(string)
	}
	changed := old.String("url") != item.Config.URL || old.String("authorization_mode") != mode ||
		old.String("authorization_method") != method || old.Int("timeout_ms") != int64(item.Config.TimeoutMs) ||
		old.String("auth_header_name") != item.Auth.Header || previousScopes != strings.Join(strings.Fields(item.OAuth.Scope), " ")
	revision := old.Int("config_revision")
	connectionStatus := old.String("connection_status")
	if changed {
		revision++
		connectionStatus = "unknown"
		if err := sqlc.New(tx).InvalidateImportTools(ctx, id); err != nil {
			return err
		}
		if mode != old.String("authorization_mode") {
			if err := sqlc.New(tx).RevokeImportCredentials(ctx, id); err != nil {
				return err
			}
		}
	}
	data["config_revision"], data["connection_status"], data["config_changed"] = revision, connectionStatus, changed
	return sqlc.New(tx).UpdateImportConnector(ctx, payload(data))
}
