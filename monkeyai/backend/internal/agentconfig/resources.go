package agentconfig

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Resources struct {
	store  *resource.Store
	mcp    *mcp.Service
	skills *skill.Service
}

func NewResources(store *resource.Store, m *mcp.Service, s *skill.Service) *Resources {
	return &Resources{store: store, mcp: m, skills: s}
}

type catalog struct {
	rules, skills, experts, connectors map[string]resource.Object
	grants                             map[string]bool
	required                           map[string]bool
	links                              map[string][]resource.Object
	models                             map[string]bool
	providers                          map[string]resource.Object
}

func (r *Resources) load(ctx context.Context, q resource.Queryer, user, kind string) (catalog, error) {
	c := catalog{grants: map[string]bool{}, required: map[string]bool{}, links: map[string][]resource.Object{}, models: map[string]bool{}}
	queries := sqlc.New(q)
	targets := []struct {
		table string
		out   *map[string]resource.Object
		read  func(context.Context) ([][]byte, error)
	}{{"rules", &c.rules, queries.CatalogRules}, {"skills", &c.skills, queries.CatalogSkills},
		{"experts", &c.experts, queries.CatalogExperts}, {"connectors", &c.connectors, queries.CatalogConnectors},
		{"connector_providers", &c.providers, queries.CatalogProviders}}
	for _, t := range targets {
		if (kind == "rules" || kind == "skills") && t.table != kind {
			continue
		}
		if kind == "connectors" && t.table != "connectors" && t.table != "connector_providers" {
			continue
		}
		out, err := resource.DecodeObjects(t.read(ctx))
		if err != nil {
			return c, err
		}
		*t.out = map[string]resource.Object{}
		for _, o := range out {
			(*t.out)[o.String("id")] = o
		}
	}
	g, err := resource.DecodeObjects(sqlc.New(q).ListGrants(ctx, new(user)))
	if err != nil {
		return c, err
	}
	for _, o := range g {
		c.grants[o.String("kind")+":"+o.String("id")] = true
		if o.Bool("required") {
			c.required[o.String("id")] = true
		}
	}
	if kind == "rules" || kind == "skills" || kind == "connectors" {
		return c, nil
	}
	for _, link := range []struct {
		table string
		read  func(context.Context) ([][]byte, error)
	}{{"expert_rules", queries.CatalogRuleLinks}, {"expert_skills", queries.CatalogSkillLinks}, {"expert_connector_providers", queries.CatalogProviderLinks}} {
		out, err := resource.DecodeObjects(link.read(ctx))
		if err != nil {
			return c, err
		}
		for _, o := range out {
			c.links[o.String("expert_id")+":"+link.table] = append(c.links[o.String("expert_id")+":"+link.table], o)
		}
	}
	models, err := resource.DecodeObjects(sqlc.New(q).ListModels(ctx))
	if err != nil {
		return c, err
	}
	var admin bool
	admin, err = sqlc.New(q).IsAdmin(ctx, user)
	if err != nil {
		return c, err
	}

	for _, m := range models {
		c.models[m.String("id")] = m.Bool("enabled") && (admin || m.String("owner_user_id") == user || c.grants["model:"+m.String("id")])
	}
	return c, nil
}
func (c catalog) allowed(kind string, o resource.Object, user string) bool {
	if o == nil {
		return false
	}
	if v, ok := o["enabled"].(bool); ok && !v {
		return false
	}
	if kind == "connector" {
		p := c.providers[o.String("provider_id")]
		if p == nil || !p.Bool("enabled") {
			return false
		}
		if o.String("ownership_type") == "user" {
			return o.String("owner_user_id") == user
		}
	}
	return (o.String("ownership_type") == "user" && o.String("owner_user_id") == user) || c.grants[kind+":"+o.String("id")]
}
func ruleDTO(o resource.Object, required bool) resource.Object {
	return resource.Object{"id": o["id"], "name": o["name"], "content": o["content"], "sha256": resource.Hash(o["content"]), "required": required}
}
func skillDTO(o resource.Object, expert string) resource.Object {
	path := "/api/v1/skills/" + o.String("id") + "/package"
	if expert != "" {
		path = "/api/v1/experts/" + expert + "/skills/" + o.String("id") + "/package"
	}
	return resource.Object{"id": o["id"], "name": o["name"], "description": o["description"], "package_size_bytes": o["package_size_bytes"], "package_sha256": o["package_sha256"], "file_count": o["file_count"], "download_path": path + "?sha256=" + o.String("package_sha256")}
}
func (r *Resources) connectorDTO(ctx context.Context, q resource.Queryer, c catalog, o resource.Object, user string) (resource.Object, error) {
	tools, err := r.mcp.Tools(ctx, q, o, user, false)
	if err != nil {
		return nil, err
	}
	safe := []resource.Object{}
	for _, t := range tools {
		safe = append(safe, resource.Object{"id": t["id"], "name": t["name"], "description": t["description"], "input_schema": t["input_schema"], "credits_per_call": t["credits_per_call"], "enabled": t["enabled"]})
	}
	status := "not_required"
	if o.String("authorization_mode") != "none" {
		status = "authorization_required"
		cred, err := r.mcp.Credential(ctx, q, o, user)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		if cred != nil {
			var valid bool
			var record *bool
			record, err = sqlc.New(q).CredentialCurrent(ctx, cred.String("id"))
			if err != nil {
				return nil, err
			}
			valid = record != nil && *record

			if valid {
				status = "authorized"
			}
		}
	}
	return resource.Object{"id": o["id"], "provider_id": o["provider_id"], "provider_identifier": c.providers[o.String("provider_id")]["identifier"], "icon_path": connectorIcon(c.providers[o.String("provider_id")], o.String("id")), "name": o["name"], "authorization_mode": o["authorization_mode"], "authorization_method": o["authorization_method"], "authorization_status": status, "connection_status": o["connection_status"], "capabilities": []string{"catalog"}, "tools": safe, "tools_version": resource.Hash(safe), "tools_path": "/api/v1/connectors/" + o.String("id") + "/tools"}, nil
}
func (r *Resources) manifest(ctx context.Context, q resource.Queryer, c catalog, expert, user string) (resource.Object, error) {
	e := c.experts[expert]
	if !c.allowed("expert", e, user) {
		return nil, resource.NotFound
	}
	rules, skills, providers, issues := []resource.Object{}, []resource.Object{}, []resource.Object{}, []resource.Object{}
	for _, link := range c.links[expert+":expert_rules"] {
		o := c.rules[link.String("rule_id")]
		if o == nil {
			issues = append(issues, resource.Object{"code": "rule_missing", "blocking": true})
			continue
		}
		rules = append(rules, ruleDTO(o, false))
	}
	for _, link := range c.links[expert+":expert_skills"] {
		o := c.skills[link.String("skill_id")]
		if o == nil || !o.Bool("enabled") {
			issues = append(issues, resource.Object{"code": "skill_disabled", "blocking": true})
			continue
		}
		skills = append(skills, skillDTO(o, expert))
	}
	for _, link := range c.links[expert+":expert_connector_providers"] {
		candidates := []resource.Object{}
		for _, o := range c.connectors {
			if o.String("provider_id") == link.String("provider_id") && c.allowed("connector", o, user) {
				dto, err := r.connectorDTO(ctx, q, c, o, user)
				if err != nil {
					return nil, err
				}
				filtered := []resource.Object{}
				for _, t := range dto["tools"].([]resource.Object) {
					allow := resource.Strings(link["tool_allowlist"])
					deny := resource.Strings(link["tool_denylist"])
					if (len(allow) == 0 || slices.Contains(allow, t.String("name"))) && !slices.Contains(deny, t.String("name")) {
						filtered = append(filtered, t)
					}
				}
				dto["tools"] = filtered
				dto["tools_version"] = resource.Hash(filtered)
				candidates = append(candidates, dto)
			}
		}
		resource.Stable(candidates)
		ready := false
		for _, o := range candidates {
			if o.String("authorization_status") != "authorization_required" {
				ready = true
			}
		}
		if !ready && link.Bool("required") {
			code := "missing_connector"
			if len(candidates) > 0 {
				code = "authorization_required"
			}
			issues = append(issues, resource.Object{"code": code, "provider_id": link["provider_id"], "blocking": true})
		}
		providers = append(providers, resource.Object{"id": link["provider_id"], "provider_id": link["provider_id"], "required": link["required"], "tool_allowlist": link["tool_allowlist"], "tool_denylist": link["tool_denylist"], "connectors": candidates})
	}
	model := e.String("default_model_id")
	if model != "" && !c.models[model] {
		issues = append(issues, resource.Object{"code": "model_unavailable", "blocking": true})
		model = ""
	}
	resource.Stable(rules)
	resource.Stable(skills)
	resource.Stable(providers)
	slices.SortFunc(issues, func(a, b resource.Object) int { return strings.Compare(resource.Hash(a), resource.Hash(b)) })
	out := resource.Object{"expert_id": expert, "name": e["name"], "prompt": e["prompt"], "default_model_id": model, "rules": rules, "skills": skills, "providers": providers, "issues": issues, "available": len(issues) == 0}
	out["version"] = resource.Hash(out)
	return out, nil
}
func (r *Resources) list(ctx context.Context, q resource.Queryer, user, kind string) ([]resource.Object, error) {
	c, err := r.load(ctx, q, user, kind)
	if err != nil {
		return nil, err
	}
	var items map[string]resource.Object
	var resourceType string
	switch kind {
	case "rules":
		items, resourceType = c.rules, "rule"
	case "skills":
		items, resourceType = c.skills, "skill"
	case "experts":
		items, resourceType = c.experts, "expert"
	case "connectors":
		items, resourceType = c.connectors, "connector"
	default:
		return nil, resource.NotFound
	}
	out := []resource.Object{}
	for id, o := range items {
		if !c.allowed(resourceType, o, user) {
			continue
		}
		var dto resource.Object
		switch kind {
		case "rules":
			dto = ruleDTO(o, c.required[id])
		case "skills":
			dto = skillDTO(o, "")
			dto["tags"], err = resource.DecodeObjects(sqlc.New(q).ListSkillTags(ctx, id))
		case "experts":
			var manifest resource.Object
			manifest, err = r.manifest(ctx, q, c, id, user)
			if err == nil {
				dto = resource.Object{"id": id, "name": o["name"], "description": o["description"], "version": manifest["version"], "manifest_path": "/api/v1/experts/" + id + "/manifest", "available": manifest["available"], "issues": manifest["issues"]}
			}
		case "connectors":
			dto, err = r.connectorDTO(ctx, q, c, o, user)
		}
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	resource.Stable(out)
	return out, nil
}

func (r *Resources) getList(w http.ResponseWriter, req *http.Request, kind string) {
	u, _ := identity.UserFromContext(req.Context())
	tx, err := r.transaction(req.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(req.Context())
	items, err := r.list(req.Context(), tx, u.ID, kind)
	if err == nil {
		err = httpapi.CachedJSON(w, req, map[string]any{kind: items})
	}
	if err != nil {
		resource.Fail(w, err)
	}
}

func (r *Resources) transaction(ctx context.Context) (pgx.Tx, error) {
	return r.store.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
}
func (r *Resources) RegisterAgent(router chi.Router) {
	for _, kind := range []string{"rules", "skills", "experts", "connectors"} {
		router.Get("/"+kind, func(w http.ResponseWriter, req *http.Request) { r.getList(w, req, kind) })
	}
	router.Get("/experts/{id}/manifest", r.getManifest)
	router.Post("/resources/resolve", r.resolve)
	router.Get("/skills/{id}/package", func(w http.ResponseWriter, req *http.Request) { r.download(w, req, false) })
	router.Get("/experts/{id}/skills/{skillID}/package", func(w http.ResponseWriter, req *http.Request) { r.download(w, req, true) })
}
func (r *Resources) getManifest(w http.ResponseWriter, req *http.Request) {
	u, _ := identity.UserFromContext(req.Context())
	tx, err := r.transaction(req.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(req.Context())
	c, err := r.load(req.Context(), tx, u.ID, "")
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := r.manifest(req.Context(), tx, c, chi.URLParam(req, "id"), u.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	etag := fmt.Sprintf(`"%s"`, out.String("version"))
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if req.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	resource.JSON(w, 200, out)
}
func (r *Resources) download(w http.ResponseWriter, req *http.Request, delegated bool) {
	u, _ := identity.UserFromContext(req.Context())
	tx, err := r.transaction(req.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(req.Context())
	c, err := r.load(req.Context(), tx, u.ID, "")
	if err != nil {
		resource.Fail(w, err)
		return
	}
	id := chi.URLParam(req, "id")
	allowed := false
	if delegated {
		expert := id
		id = chi.URLParam(req, "skillID")
		if c.allowed("expert", c.experts[expert], u.ID) && c.skills[id] != nil && c.skills[id].Bool("enabled") {
			for _, l := range c.links[expert+":expert_skills"] {
				if l.String("skill_id") == id {
					allowed = true
				}
			}
		}
	} else {
		allowed = c.allowed("skill", c.skills[id], u.ID)
	}
	if !allowed {
		resource.Fail(w, resource.NotFound)
		return
	}
	r.skills.Download(w, req, id)
}
func (r *Resources) resolve(w http.ResponseWriter, req *http.Request) {
	var in resource.Object
	if err := resource.Decode(w, req, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	u, _ := identity.UserFromContext(req.Context())
	out, err := r.Resolve(req.Context(), u.ID, in)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, out)
}
func (r *Resources) Resolve(ctx context.Context, user string, in resource.Object) (resource.Object, error) {
	tx, err := r.transaction(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := r.load(ctx, tx, user, "")
	if err != nil {
		return nil, err
	}
	out := resource.Object{"expert_id": "", "prompt": "", "rules": []resource.Object{}, "skills": []resource.Object{}, "providers": []resource.Object{}, "issues": []resource.Object{}, "available": true}
	if id := in.String("expert_id"); id != "" {
		out, err = r.manifest(ctx, tx, c, id, user)
		if err != nil {
			return nil, err
		}
	}
	rules := []resource.Object{}
	for id, o := range c.rules {
		if c.required[id] && c.allowed("rule", o, user) {
			rules = append(rules, ruleDTO(o, true))
		}
	}
	resource.Stable(rules)
	rules = append(rules, out["rules"].([]resource.Object)...)
	selected := []resource.Object{}
	for _, id := range resource.Strings(in["rule_ids"]) {
		o := c.rules[id]
		if !c.allowed("rule", o, user) {
			return nil, resource.NotFound
		}
		selected = append(selected, o)
	}
	slices.SortFunc(selected, func(a, b resource.Object) int {
		if a.String("ownership_type") != b.String("ownership_type") {
			return strings.Compare(a.String("ownership_type"), b.String("ownership_type"))
		}
		return strings.Compare(a.String("id"), b.String("id"))
	})
	for _, o := range selected {
		rules = append(rules, ruleDTO(o, c.required[o.String("id")]))
	}
	skills := out["skills"].([]resource.Object)
	selected = []resource.Object{}
	for _, id := range resource.Strings(in["skill_ids"]) {
		o := c.skills[id]
		if !c.allowed("skill", o, user) {
			return nil, resource.NotFound
		}
		selected = append(selected, o)
	}
	slices.SortFunc(selected, func(a, b resource.Object) int {
		if a.String("ownership_type") != b.String("ownership_type") {
			return strings.Compare(b.String("ownership_type"), a.String("ownership_type"))
		}
		return strings.Compare(a.String("id"), b.String("id"))
	})
	for _, o := range selected {
		skills = append(skills, skillDTO(o, ""))
	}
	dedup := func(items []resource.Object) []resource.Object {
		result := []resource.Object{}
		names := map[string]bool{}
		ids := map[string]bool{}
		for _, o := range items {
			name := strings.ToLower(strings.TrimSpace(o.String("name")))
			if names[name] || ids[o.String("id")] {
				continue
			}
			names[name] = true
			ids[o.String("id")] = true
			result = append(result, o)
		}
		return result
	}
	out["rules"] = dedup(rules)
	out["skills"] = dedup(skills)
	bindings := map[string]string{}
	if raw, ok := in["connector_bindings"].(map[string]any); ok {
		for provider, value := range raw {
			id, ok := value.(string)
			if !ok {
				return nil, resource.Invalid("连接绑定无效")
			}
			bindings[provider] = id
		}
	}
	resolved := []resource.Object{}
	for _, p := range out["providers"].([]resource.Object) {
		id, ok := bindings[p.String("provider_id")]
		if !ok {
			candidates := p["connectors"].([]resource.Object)
			ready := []resource.Object{}
			for _, v := range candidates {
				if v.String("authorization_status") != "authorization_required" {
					ready = append(ready, v)
				}
			}
			if len(ready) == 1 {
				id = ready[0].String("id")
			} else {
				if p.Bool("required") {
					out["available"] = false
					out["issues"] = append(out["issues"].([]resource.Object), resource.Object{"code": "connector_selection_required", "provider_id": p["provider_id"], "blocking": true})
				}
				continue
			}
		}
		found := false
		for _, conn := range p["connectors"].([]resource.Object) {
			if conn.String("id") == id {
				if conn.String("authorization_status") == "authorization_required" {
					return nil, resource.Invalid("连接需要认证")
				}
				resolved = append(resolved, conn)
				found = true
			}
		}
		if !found {
			return nil, resource.NotFound
		}
		delete(bindings, p.String("provider_id"))
	}
	for provider, id := range bindings {
		o := c.connectors[id]
		if !c.allowed("connector", o, user) || o.String("provider_id") != provider {
			return nil, resource.NotFound
		}
		dto, err := r.connectorDTO(ctx, tx, c, o, user)
		if err != nil {
			return nil, err
		}
		if dto.String("authorization_status") == "authorization_required" {
			return nil, resource.Invalid("连接需要认证")
		}
		resolved = append(resolved, dto)
	}
	resource.Stable(resolved)
	out["connectors"] = resolved
	delete(out, "version")
	out["version"] = resource.Hash(out)
	return out, nil
}
func (r *Resources) RegisterAdmin(router chi.Router) {
	router.Post("/experts/{id}/preview", func(w http.ResponseWriter, req *http.Request) {
		var in resource.Object
		if err := resource.Decode(w, req, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		user := in.String("user_id")
		in["expert_id"] = chi.URLParam(req, "id")
		out, err := r.Resolve(req.Context(), user, in)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, 200, out)
	})
}

func connectorIcon(provider resource.Object, id string) string {
	if provider.String("icon_s3_key") == "" {
		return ""
	}
	return "/api/v1/connectors/" + id + "/icon?v=" + resource.Hash(provider["icon_s3_key"])
}
