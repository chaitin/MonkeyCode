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
}

func (r *Resources) load(ctx context.Context, q resource.Queryer, user, kind string) (catalog, error) {
	c := catalog{grants: map[string]bool{}, required: map[string]bool{}, links: map[string][]resource.Object{}}
	systemAccess, err := resource.CanUseSystem(ctx, q, user)
	if err != nil {
		return c, err
	}
	queries := sqlc.New(q)
	targets := []struct {
		table string
		out   *map[string]resource.Object
		read  func(context.Context) ([][]byte, error)
	}{{"rules", &c.rules, queries.CatalogRules}, {"skills", &c.skills, queries.CatalogSkills},
		{"experts", &c.experts, queries.CatalogExperts}, {"connectors", &c.connectors, queries.CatalogConnectors}}
	for _, t := range targets {
		if (kind == "rules" || kind == "skills") && t.table != kind {
			continue
		}
		if kind == "connectors" && t.table != "connectors" {
			continue
		}
		out, err := resource.DecodeObjects(t.read(ctx))
		if err != nil {
			return c, err
		}
		*t.out = map[string]resource.Object{}
		for _, o := range out {
			if !systemAccess && o.String("ownership_type") == "system" {
				continue
			}
			(*t.out)[o.String("id")] = o
		}
	}
	g, err := resource.DecodeObjects(sqlc.New(q).ListGrants(ctx, new(user)))
	if err != nil {
		return c, err
	}
	for _, o := range g {
		if o.String("kind") == "rule" {
			rule := c.rules[o.String("id")]
			if rule == nil || rule.String("ownership_type") == "user" {
				continue
			}
		}
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
	}{{"expert_rules", queries.CatalogRuleLinks}, {"expert_skills", queries.CatalogSkillLinks}, {"expert_connectors", queries.CatalogConnectorLinks}} {
		out, err := resource.DecodeObjects(link.read(ctx))
		if err != nil {
			return c, err
		}
		for _, o := range out {
			c.links[o.String("expert_id")+":"+link.table] = append(c.links[o.String("expert_id")+":"+link.table], o)
		}
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
	if kind == "rule" && o.String("ownership_type") == "user" {
		return user != "" && o.String("owner_user_id") == user
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
	return r.mcp.Catalog(ctx, q, o, user)
}

func filterTools(dto, link resource.Object) {
	filter := func(target resource.Object) {
		tools, _ := target["tools"].([]resource.Object)
		filtered := []resource.Object{}
		allow, deny := resource.Strings(link["tool_allowlist"]), resource.Strings(link["tool_denylist"])
		for _, tool := range tools {
			if (len(allow) == 0 || slices.Contains(allow, tool.String("name"))) && !slices.Contains(deny, tool.String("name")) {
				filtered = append(filtered, tool)
			}
		}
		target["tools"], target["tools_version"] = filtered, resource.Hash(filtered)
	}
	if dto.String("authorization_mode") == "independent" {
		for _, credential := range dto["credentials"].([]resource.Object) {
			filter(credential)
		}
	} else {
		filter(dto)
	}
}
func connectorReady(dto resource.Object) bool {
	if dto.String("authorization_mode") != "independent" {
		return dto.String("authorization_status") != "authorization_required"
	}
	for _, credential := range dto["credentials"].([]resource.Object) {
		if credential.String("authorization_status") == "authorized" {
			return true
		}
	}
	return false
}

func (r *Resources) manifest(ctx context.Context, q resource.Queryer, c catalog, expert, user string) (resource.Object, error) {
	e := c.experts[expert]
	if !c.allowed("expert", e, user) {
		return nil, resource.NotFound
	}
	rules, skills, connectors, issues := []resource.Object{}, []resource.Object{}, []resource.Object{}, []resource.Object{}
	for _, link := range c.links[expert+":expert_rules"] {
		o := c.rules[link.String("rule_id")]
		if o == nil || (e.String("ownership_type") == "user" && !c.allowed("rule", o, user)) {
			issues = append(issues, resource.Object{"code": "rule_missing", "blocking": true})
			continue
		}
		rules = append(rules, ruleDTO(o, false))
	}
	for _, link := range c.links[expert+":expert_skills"] {
		o := c.skills[link.String("skill_id")]
		if o == nil || !o.Bool("enabled") || (e.String("ownership_type") == "user" && !c.allowed("skill", o, user)) {
			issues = append(issues, resource.Object{"code": "skill_disabled", "blocking": true})
			continue
		}
		skills = append(skills, skillDTO(o, expert))
	}
	for _, link := range c.links[expert+":expert_connectors"] {
		o := c.connectors[link.String("connector_id")]
		if !c.allowed("connector", o, user) {
			issues = append(issues, resource.Object{"code": "missing_connector", "connector_id": link["connector_id"], "blocking": link.Bool("required")})
			continue
		}
		dto, err := r.connectorDTO(ctx, q, c, o, user)
		if err != nil {
			return nil, err
		}
		dto["required"], dto["tool_allowlist"], dto["tool_denylist"] = link["required"], link["tool_allowlist"], link["tool_denylist"]
		filterTools(dto, link)
		if !connectorReady(dto) {
			issues = append(issues, resource.Object{"code": "authorization_required", "connector_id": link["connector_id"], "blocking": link.Bool("required")})
		}
		connectors = append(connectors, dto)
	}

	resource.Stable(rules)
	resource.Stable(skills)
	resource.Stable(connectors)
	slices.SortFunc(issues, func(a, b resource.Object) int { return strings.Compare(resource.Hash(a), resource.Hash(b)) })
	out := resource.Object{"expert_id": expert, "name": e["name"], "prompt": e["prompt"], "rules": rules, "skills": skills, "connectors": connectors, "issues": issues, "available": true}
	for _, issue := range issues {
		if issue.Bool("blocking") {
			out["available"] = false
		}
	}
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
	owned := []string{}
	owners := []string{}
	ownerIDs := map[string]string{}
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
		dto["ownership_type"] = o["ownership_type"]
		owners = append(owners, o.String("owner_user_id"))
		ownerIDs[id] = o.String("owner_user_id")
		dto["revision"] = o["revision"]
		if resourceType != "rule" && o.String("ownership_type") == "user" && o.String("owner_user_id") == user {
			owned = append(owned, id)
		}
		out = append(out, dto)
	}
	people, err := resource.Users(ctx, q, owners)
	if err != nil {
		return nil, err
	}
	users, err := resource.SharedUsers(ctx, q, resourceType, owned)
	if err != nil {
		return nil, err
	}
	for _, dto := range out {
		dto["user"] = people[ownerIDs[dto.String("id")]]
		if shared, ok := users[dto.String("id")]; ok {
			dto["shared_users"] = shared
		}
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
		e := c.experts[expert]
		if c.allowed("expert", e, u.ID) && c.skills[id] != nil && c.skills[id].Bool("enabled") && (e.String("ownership_type") == "system" || c.allowed("skill", c.skills[id], u.ID)) {
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
	out := resource.Object{"expert_id": "", "prompt": "", "rules": []resource.Object{}, "skills": []resource.Object{}, "connectors": []resource.Object{}, "issues": []resource.Object{}, "available": true}
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
	selectedConnectors := out["connectors"].([]resource.Object)
	seenConnectors := map[string]bool{}
	for _, conn := range selectedConnectors {
		seenConnectors[conn.String("id")] = true
	}
	for _, id := range resource.Strings(in["connector_ids"]) {
		o := c.connectors[id]
		if !c.allowed("connector", o, user) {
			return nil, resource.NotFound
		}
		if seenConnectors[id] {
			for _, conn := range selectedConnectors {
				if conn.String("id") == id {
					conn["required"] = true
				}
			}
			continue
		}
		dto, err := r.connectorDTO(ctx, tx, c, o, user)
		if err != nil {
			return nil, err
		}
		dto["required"] = true
		selectedConnectors = append(selectedConnectors, dto)
		seenConnectors[id] = true
	}
	bindings := map[string]string{}
	if raw, exists := in["connector_bindings"]; exists {
		values, ok := raw.(map[string]any)
		if !ok {
			return nil, resource.Invalid("凭证绑定必须为连接 ID 到凭证 ID 的对象")
		}
		for id, value := range values {
			credential, ok := value.(string)
			if !ok || credential == "" || !seenConnectors[id] {
				return nil, resource.Invalid("凭证绑定无效，必须先选择连接")
			}
			bindings[id] = credential
		}
	}
	resolved := []resource.Object{}
	issue := func(code string, conn resource.Object) {
		for _, existing := range out["issues"].([]resource.Object) {
			if existing.String("connector_id") == conn.String("id") && existing.String("code") == code {
				if conn.Bool("required") {
					existing["blocking"] = true
					out["available"] = false
				}
				return
			}
		}
		out["issues"] = append(out["issues"].([]resource.Object), resource.Object{"code": code, "connector_id": conn["id"], "blocking": conn.Bool("required")})
		if conn.Bool("required") {
			out["available"] = false
		}
	}
	for _, conn := range selectedConnectors {
		id := conn.String("id")
		selected := bindings[id]
		if conn.String("authorization_mode") != "independent" {
			if selected != "" {
				return nil, resource.Invalid("此连接不使用独立凭证绑定")
			}
			if !connectorReady(conn) {
				issue("authorization_required", conn)
				continue
			}
			resolved = append(resolved, conn)
			continue
		}
		credentials := conn["credentials"].([]resource.Object)
		var chosen resource.Object
		ready := []resource.Object{}
		for _, credential := range credentials {
			if credential.String("id") == selected {
				chosen = credential
			}
			if credential.String("authorization_status") == "authorized" {
				ready = append(ready, credential)
			}
		}
		if selected != "" {
			if chosen == nil {
				return nil, resource.NotFound
			}
			if chosen.String("authorization_status") != "authorized" {
				return nil, &resource.Error{Status: 403, Code: "authorization_required", Message: "所选凭证需要认证"}
			}
		} else if len(ready) == 1 {
			chosen = ready[0]
		} else {
			code := "credential_selection_required"
			if len(ready) == 0 {
				code = "authorization_required"
			}
			issue(code, conn)
			continue
		}
		conn["credential_id"] = chosen["id"]
		for _, key := range []string{"authorization_status", "connection_status", "tools", "tools_version", "mcp_gateway"} {
			conn[key] = chosen[key]
		}
		delete(conn, "credentials")
		resolved = append(resolved, conn)
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
