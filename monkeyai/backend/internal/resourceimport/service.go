package resourceimport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"hash/fnv"
	"log/slog"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type historyCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
}

func decodeHistoryCursor(value string) ([]byte, error) {
	if value == "" {
		return []byte("{}"), nil
	}
	if len(value) > 512 {
		return nil, resource.Invalid("分页游标无效")
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(data) > 256 {
		return nil, resource.Invalid("分页游标无效")
	}
	var cursor historyCursor
	if json.Unmarshal(data, &cursor) != nil || cursor.CreatedAt.IsZero() {
		return nil, resource.Invalid("分页游标无效")
	}
	if _, err = uuid.Parse(cursor.ID); err != nil {
		return nil, resource.Invalid("分页游标无效")
	}
	return json.Marshal(cursor)
}

func (s *Service) RegisterAdmin(router chi.Router) {
	s.RegisterUploads(router)
	router.Post("/resource-imports/preview", func(w http.ResponseWriter, r *http.Request) {
		loaded, err := s.loadImport(w, r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		defer loaded.cleanup()
		if loaded.input.DiscoverOnly {
			s.discovery(w, r, loaded)
			return
		}
		if loaded.input.Sections != nil {
			out, err := s.previewSections(r.Context(), loaded)
			if err != nil {
				resource.Fail(r.Context(), w, err)
				return
			}
			resource.JSON(r.Context(), w, http.StatusOK, out)
			return
		}
		out, err := s.Evaluate(r.Context(), s.Pool, loaded.pkg, loaded.items, loaded.input.Options, loaded.sha)
		if err != nil {
			resource.Fail(r.Context(), w, &resource.Error{Status: 409, Code: "import_conflict", Message: err.Error()})
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, out)
	})
	router.Post("/resource-imports", func(w http.ResponseWriter, r *http.Request) {
		loaded, err := s.loadImport(w, r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		defer loaded.cleanup()
		if loaded.input.DiscoverOnly {
			resource.Fail(r.Context(), w, resource.Invalid("分区发现结果不能用于确认导入"))
			return
		}
		if loaded.input.Sections != nil {
			out, status, err := s.applySections(r.Context(), loaded)
			if err != nil {
				resource.Fail(r.Context(), w, err)
				return
			}
			if status >= 400 {
				resource.Fail(r.Context(), w, &resource.Error{Status: status, Code: "import_failed", Message: "所选分区导入失败，请检查分区结果", References: out})
				return
			}
			if err = s.finishSections(r.Context(), loaded); err != nil {
				out.Warning = "分区已提交，上传状态未更新；请刷新恢复"
			}
			resource.JSON(r.Context(), w, status, out)
			return
		}
		if loaded.input.PackageSHA256 != loaded.sha || loaded.input.PlanDigest == "" || !loaded.input.Options.ConfirmFinal {
			resource.Fail(r.Context(), w, resource.Invalid("必须先预览并确认本包是最终 Agent 资源集合"))
			return
		}
		out, err := s.Apply(r.Context(), loaded.pkg, loaded.items, loaded.input.Options, loaded.sha, loaded.input.PlanDigest)
		if err == nil {
			logging.Bind(r.Context(), slog.String("phase", "finish_upload"))
			err = loaded.finish(r.Context())
			if err != nil {
				logging.Diagnostic(r.Context(), slog.Default(), slog.LevelError, "resource.import.finish.failed", err)
			}
			if err == nil && !out.AlreadyImported {
				logging.Event(r.Context(), slog.Default(), slog.LevelInfo, "resource.import.completed", "资源包导入已完成")
			}
		}
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, out)
	})
	router.Get("/resource-imports", func(w http.ResponseWriter, r *http.Request) {
		limit := 20
		if raw := r.URL.Query().Get("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > 500 {
				resource.Fail(r.Context(), w, resource.Invalid("limit 必须为 1 至 500"))
				return
			}
			limit = n
		}
		cursor, err := decodeHistoryCursor(r.URL.Query().Get("cursor"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		rows, err := sqlc.New(s.Pool).ListImportHistory(r.Context(), sqlc.ListImportHistoryParams{Cursor: cursor, PageLimit: int32(limit + 1)})
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		list := []resource.Object{}
		for _, data := range rows {
			var item resource.Object
			if err = json.Unmarshal(data, &item); err != nil {
				resource.Fail(r.Context(), w, err)
				return
			}
			list = append(list, item)
		}
		var nextCursor any
		if hasMore {
			last := list[len(list)-1]
			createdAt, parseErr := time.Parse(time.RFC3339Nano, last.String("created_at"))
			if parseErr != nil {
				resource.Fail(r.Context(), w, parseErr)
				return
			}
			data, marshalErr := json.Marshal(historyCursor{CreatedAt: createdAt, ID: last.String("id")})
			if marshalErr != nil {
				resource.Fail(r.Context(), w, marshalErr)
				return
			}
			nextCursor = base64.RawURLEncoding.EncodeToString(data)
		}
		resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"items": list, "next_cursor": nextCursor})
	})
	router.Get("/resource-imports/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if _, err := uuid.Parse(id); err != nil {
			resource.Fail(r.Context(), w, resource.NotFound)
			return
		}
		data, err := sqlc.New(s.Pool).GetImportHistory(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			resource.Fail(r.Context(), w, resource.NotFound)
			return
		}
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		var result resource.Object
		if err = json.Unmarshal(data, &result); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, result)
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

func (s *Service) prepareObjects(ctx context.Context, pkg Package, p Preview, r Resources) (map[string]string, func(), error) {
	keys := map[string]string{}
	written := []string{}
	cleanup := func() {
		for _, key := range written {
			if err := s.Storage.Delete(context.WithoutCancel(ctx), key); err != nil {
				logging.Event(ctx, slog.Default(), slog.LevelWarn, "resource.import.compensation.failed", "导入对象存储补偿失败", "module", "resourceimport", "operation", "prepareObjects", "phase", "compensation", "error", err)
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
			body, err := pkg.SkillBytes(item)
			if err != nil {
				cleanup()
				return nil, nil, err
			}
			key := "resource-import/skills/" + resource.ID() + ".zip"
			if err := s.Storage.Put(ctx, key, body, "application/zip"); err != nil {
				cleanup()
				return nil, nil, err
			}
			keys["skill:"+c.Slug], written = key, append(written, key)
		}
		if item, ok := r.Experts[c.Slug]; ok && c.Type == "expert" && item.HasAvatar {
			body, err := pkg.AvatarBytes(item)
			if err != nil {
				cleanup()
				return nil, nil, err
			}
			key := "resource-import/experts/" + resource.ID() + ".webp"
			if err := s.Storage.Put(ctx, key, body, "image/webp"); err != nil {
				cleanup()
				return nil, nil, err
			}
			keys["expert:"+c.Slug], written = key, append(written, key)
		}
		if item, ok := r.Connectors[c.Slug]; ok && c.Type == "connector" && item.HasAvatar {
			body, err := pkg.ConnectorAvatarBytes(item)
			if err != nil {
				cleanup()
				return nil, nil, err
			}
			key, mime := connectorAvatarObject(item)
			if err := s.Storage.Put(ctx, key, body, mime); err != nil {
				cleanup()
				return nil, nil, err
			}
			keys["connector:"+c.Slug], written = key, append(written, key)
		}
	}
	return keys, cleanup, nil
}

func connectorAvatarObject(item Connector) (string, string) {
	ext := strings.ToLower(path.Ext(item.Entry.AvatarPath))
	mime := "application/octet-stream"
	switch ext {
	case ".jpeg", ".jpg":
		mime = "image/jpeg"
	case ".png":
		mime = "image/png"
	case ".webp":
		mime = "image/webp"
	default:
		ext = ".webp"
		mime = "image/webp"
	}
	return "resource-import/connectors/" + resource.ID() + ext, mime
}

func (s *Service) Apply(ctx context.Context, p Package, r Resources, opts Options, packageSHA, expectedDigest string) (Preview, error) {
	return s.apply(ctx, p, r, opts, packageSHA, expectedDigest, nil)
}

func (s *Service) apply(ctx context.Context, p Package, r Resources, opts Options, packageSHA, expectedDigest string, receipt func(pgx.Tx, Preview) error) (Preview, error) {
	logging.Bind(ctx, slog.String("phase", "apply"))
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
			if c.Type == "skill" && c.Action != "retain" && len(c.Warnings) != 0 {
				return pre, resource.Invalid("请确认技能 frontmatter 的规范化变更")
			}
		}
	}
	objects, cleanup, err := s.prepareObjects(ctx, p, pre, r)
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
	logging.Bind(ctx, slog.String("import_id", importID))
	counts := map[string]int{"create": 0, "update": 0, "skip": 0, "retain": 0, "retire": 0, "restore": 0, "ignored_static": len(pre.IgnoredStatic)}
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
			if change.Type != kind || change.Action == "retire" || change.Action == "retain" {
				continue
			}
			id := ids[change.Slug]
			if change.Action != "skip" {
				if err = writeResource(ctx, tx, r, change, id, actor.ID, objects, ids, opts); err != nil {
					return pre, err
				}
				if err = writeTags(ctx, tx, change, id, actor.ID); err != nil {
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
	if receipt != nil {
		if err = receipt(tx, locked); err != nil {
			return pre, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return pre, err
	}
	committed = true
	logging.Event(ctx, slog.Default(), slog.LevelInfo, "resource.import.applied", "资源包事务已提交", "import_id", importID)
	return locked, nil
}

func writeTags(ctx context.Context, tx pgx.Tx, change Change, id, actor string) error {
	if change.Tags == nil {
		return nil
	}
	ids := make([]string, 0, len(change.Tags))
	queries := sqlc.New(tx)
	for _, name := range change.Tags {
		tagID, err := queries.ResolveImportTag(ctx, sqlc.ResolveImportTagParams{Name: name, CreatedByUserID: actor})
		if err != nil {
			return err
		}
		ids = append(ids, tagID)
	}
	return resource.SaveTags(ctx, tx, change.Type, id, actor, ids)
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
			"package_size_bytes": item.StoredSize, "package_sha256": p.SHA, "file_count": item.FileCount})
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
		return writeConnector(ctx, tx, r.Connectors[change.Slug], change, id, actor, objects, opts)
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

func writeConnector(ctx context.Context, tx pgx.Tx, item Connector, change Change, id, actor string, objects map[string]string, opts Options) error {
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
	data := resource.Object{"id": id, "actor_id": actor, "name": change.Name, "description": item.Entry.Description, "url": item.Config.URL,
		"authorization_mode": mode, "authorization_method": method, "oauth_config": oauth,
		"timeout_ms": item.Config.TimeoutMs, "auth_header_name": item.Auth.Header,
		"icon_s3_key": objects["connector:"+change.Slug],
		"name_i18n":   mapOrEmpty(item.Entry.NameI18n), "description_i18n": mapOrEmpty(item.Entry.DescriptionI18n)}
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
