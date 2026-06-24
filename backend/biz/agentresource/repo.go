package agentresource

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentplugin"
	"github.com/chaitin/MonkeyCode/backend/db/agentpluginversion"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/db/agentruleversion"
	"github.com/chaitin/MonkeyCode/backend/db/agentskill"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillgroupbinding"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillversion"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
)

// Repo is the read-only surface used by the task dispatch path and by the
// public listing endpoints. All methods are safe to call concurrently.
type Repo interface {
	// ListActiveRules returns every non-deleted rule whose active version
	// row exists. Used by getCodingConfigs. Rule content comes straight from
	// the DB; there is no S3 indirection for rules.
	ListActiveRules(ctx context.Context) ([]*RuleWithVersion, error)

	// ListActiveSkills returns the union of {userSelectedIDs} and
	// {is_force_delivery=true} skills. Orphan skills are kept so the agent
	// keeps shipping whatever was previously active. Deleted skills and
	// skills without an active_version_id are skipped.
	ListActiveSkills(ctx context.Context, userSelectedIDs []uuid.UUID) ([]*SkillWithVersion, error)

	// ListActivePlugins mirrors ListActiveSkills for plugins.
	ListActivePlugins(ctx context.Context, userSelectedIDs []uuid.UUID) ([]*PluginWithVersion, error)

	// ListSkillsForListing powers the /api/v1/skills picker. Orphans are
	// hidden because users should not pick a resource that is no longer
	// in the upstream repo.
	ListSkillsForListing(ctx context.Context) ([]*ResourceListItem, error)

	// ListPluginsForListing powers the /api/v1/plugins picker.
	ListPluginsForListing(ctx context.Context) ([]*ResourceListItem, error)

	// ---- ScopeFilter variants (three-tier picker / dispatch) ----

	// ListSkillsForListingScoped returns the picker view filtered by scope.
	// Unlike the legacy variant, this does NOT filter by enabled — the
	// disabled rows are returned with Enabled=false so the picker can render
	// a greyed-out chip. Name-based override is applied (user > team > global)
	// using the rule: same name across scopes → the higher-priority one wins.
	// Groups are populated for scope=team skills only.
	ListSkillsForListingScoped(ctx context.Context, f ScopeFilter) ([]*ResourceListItem, error)

	// ListPluginsForListingScoped is the plugin counterpart. Groups are
	// always empty (no team-admin plugin upload UX).
	ListPluginsForListingScoped(ctx context.Context, f ScopeFilter) ([]*ResourceListItem, error)

	// ListActiveSkillsScoped is the dispatch-time query. It applies the
	// SAME scope filter + name-override semantics as the listing path, but
	// also filters out enabled=false rows entirely (because we won't dispatch
	// a disabled skill even if the user explicitly picked it). Returns the
	// union of {SkillSelection.UserSelectedIDs} ∪ {is_force_delivery=true}
	// within scope.
	ListActiveSkillsScoped(ctx context.Context, sel SkillSelection) ([]*SkillWithVersion, error)

	// ListActivePluginsScoped is the plugin counterpart.
	ListActivePluginsScoped(ctx context.Context, sel SkillSelection) ([]*PluginWithVersion, error)
}

type repoImpl struct {
	db *db.Client
}

// NewRepo wires a Repo backed by the given ent client.
func NewRepo(client *db.Client) Repo {
	return &repoImpl{db: client}
}

// ---- rules ----

func (r *repoImpl) ListActiveRules(ctx context.Context) ([]*RuleWithVersion, error) {
	rules, err := r.db.AgentRule.Query().
		Where(
			agentrule.IsDeletedEQ(false),
			agentrule.ActiveVersionIDNotNil(),
		).
		Order(db.Asc(agentrule.FieldName)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list rules: %w", err)
	}
	if len(rules) == 0 {
		return nil, nil
	}

	versionIDs := make([]uuid.UUID, 0, len(rules))
	for _, ru := range rules {
		if ru.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *ru.ActiveVersionID)
		}
	}

	versions, err := r.db.AgentRuleVersion.Query().
		Where(agentruleversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list rule versions: %w", err)
	}

	versionByID := make(map[uuid.UUID]*db.AgentRuleVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*RuleWithVersion, 0, len(rules))
	for _, ru := range rules {
		if ru.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*ru.ActiveVersionID]
		if !ok {
			// Active version dangling — should not happen in practice but
			// skip rather than crash task creation.
			continue
		}
		out = append(out, &RuleWithVersion{
			ID:        ru.ID,
			Name:      ru.Name,
			Version:   v.Version,
			Content:   v.Content,
			UpdatedAt: ru.UpdatedAt,
		})
	}
	return out, nil
}

// ---- skills ----

func (r *repoImpl) ListActiveSkills(ctx context.Context, userSelectedIDs []uuid.UUID) ([]*SkillWithVersion, error) {
	// Base filter: not deleted + has an active version. We then OR together
	// (id in user-selected) and (is_force_delivery = true).
	q := r.db.AgentSkill.Query().
		Where(
			agentskill.IsDeletedEQ(false),
			agentskill.ActiveVersionIDNotNil(),
		)

	if len(userSelectedIDs) == 0 {
		// Only force-delivery skills matter when the caller selected none.
		q = q.Where(agentskill.IsForceDeliveryEQ(true))
	} else {
		q = q.Where(agentskill.Or(
			agentskill.IDIn(userSelectedIDs...),
			agentskill.IsForceDeliveryEQ(true),
		))
	}

	skills, err := q.Order(db.Asc(agentskill.FieldName)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills: %w", err)
	}
	if len(skills) == 0 {
		return nil, nil
	}

	versionIDs := make([]uuid.UUID, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *s.ActiveVersionID)
		}
	}

	versions, err := r.db.AgentSkillVersion.Query().
		Where(agentskillversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skill versions: %w", err)
	}

	versionByID := make(map[uuid.UUID]*db.AgentSkillVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*SkillWithVersion, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*s.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &SkillWithVersion{
			ID:              s.ID,
			Name:            s.Name,
			Description:     s.Description,
			Version:         v.Version,
			S3Key:           v.S3Key,
			IsForceDelivery: s.IsForceDelivery,
			IsOrphan:        s.IsOrphan,
			ParsedMeta:      v.ParsedMeta,
			UpdatedAt:       s.UpdatedAt,
		})
	}
	return out, nil
}

// ---- plugins ----

func (r *repoImpl) ListActivePlugins(ctx context.Context, userSelectedIDs []uuid.UUID) ([]*PluginWithVersion, error) {
	q := r.db.AgentPlugin.Query().
		Where(
			agentplugin.IsDeletedEQ(false),
			agentplugin.ActiveVersionIDNotNil(),
		)

	if len(userSelectedIDs) == 0 {
		q = q.Where(agentplugin.IsForceDeliveryEQ(true))
	} else {
		q = q.Where(agentplugin.Or(
			agentplugin.IDIn(userSelectedIDs...),
			agentplugin.IsForceDeliveryEQ(true),
		))
	}

	plugins, err := q.Order(db.Asc(agentplugin.FieldName)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins: %w", err)
	}
	if len(plugins) == 0 {
		return nil, nil
	}

	versionIDs := make([]uuid.UUID, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *p.ActiveVersionID)
		}
	}

	versions, err := r.db.AgentPluginVersion.Query().
		Where(agentpluginversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugin versions: %w", err)
	}

	versionByID := make(map[uuid.UUID]*db.AgentPluginVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*PluginWithVersion, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*p.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &PluginWithVersion{
			ID:              p.ID,
			Name:            p.Name,
			Description:     p.Description,
			Version:         v.Version,
			S3Key:           v.S3Key,
			IsForceDelivery: p.IsForceDelivery,
			IsOrphan:        p.IsOrphan,
			Entry:           v.ParsedMeta.Entry,
			UpdatedAt:       p.UpdatedAt,
		})
	}
	return out, nil
}

// ---- listing endpoints ----

func (r *repoImpl) ListSkillsForListing(ctx context.Context) ([]*ResourceListItem, error) {
	skills, err := r.db.AgentSkill.Query().
		Where(
			agentskill.IsDeletedEQ(false),
			agentskill.IsOrphanEQ(false),
			agentskill.ActiveVersionIDNotNil(),
		).
		Order(db.Asc(agentskill.FieldName)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills for listing: %w", err)
	}
	if len(skills) == 0 {
		return nil, nil
	}

	versionIDs := make([]uuid.UUID, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *s.ActiveVersionID)
		}
	}

	versions, err := r.db.AgentSkillVersion.Query().
		Where(agentskillversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skill versions for listing: %w", err)
	}

	versionByID := make(map[uuid.UUID]*db.AgentSkillVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*ResourceListItem, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*s.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &ResourceListItem{
			ID:              s.ID,
			Name:            s.Name,
			Description:     s.Description,
			Version:         v.Version,
			IsForceDelivery: s.IsForceDelivery,
		})
	}
	return out, nil
}

// ---- ScopeFilter variants ----

// pickSkillByName 实现 user > team > global 的名字覆盖规则。同名行只保留
// 优先级最高的 scope 那一条。
func pickSkillByName(items []*db.AgentSkill) []*db.AgentSkill {
	priority := map[string]int{"global": 0, "team": 1, "user": 2}
	best := map[string]*db.AgentSkill{}
	for _, s := range items {
		cur, ok := best[s.Name]
		if !ok || priority[string(s.ScopeType)] > priority[string(cur.ScopeType)] {
			best[s.Name] = s
		}
	}
	out := make([]*db.AgentSkill, 0, len(best))
	for _, s := range best {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func pickPluginByName(items []*db.AgentPlugin) []*db.AgentPlugin {
	priority := map[string]int{"global": 0, "team": 1, "user": 2}
	best := map[string]*db.AgentPlugin{}
	for _, p := range items {
		cur, ok := best[p.Name]
		if !ok || priority[string(p.ScopeType)] > priority[string(cur.ScopeType)] {
			best[p.Name] = p
		}
	}
	out := make([]*db.AgentPlugin, 0, len(best))
	for _, p := range best {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// applyScopeSkill builds an OR predicate matching the requested scopes.
// If no scope is selected (all false/nil), returns a never-match predicate
// so the query short-circuits to empty rather than returning all rows.
func applyScopeSkill(q *db.AgentSkillQuery, f ScopeFilter) *db.AgentSkillQuery {
	var preds []predicate.AgentSkill
	if f.IncludeGlobal {
		preds = append(preds, agentskill.ScopeTypeEQ(agentskill.ScopeTypeGlobal))
	}
	if f.TeamID != nil {
		preds = append(preds, agentskill.And(
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeTeam),
			agentskill.ScopeIDEQ(f.TeamID.String()),
		))
	}
	if f.UserID != nil {
		preds = append(preds, agentskill.And(
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeUser),
			agentskill.ScopeIDEQ(f.UserID.String()),
		))
	}
	if len(preds) == 0 {
		return q.Where(agentskill.IDEQ(uuid.Nil))
	}
	return q.Where(agentskill.Or(preds...))
}

func applyScopePlugin(q *db.AgentPluginQuery, f ScopeFilter) *db.AgentPluginQuery {
	var preds []predicate.AgentPlugin
	if f.IncludeGlobal {
		preds = append(preds, agentplugin.ScopeTypeEQ(agentplugin.ScopeTypeGlobal))
	}
	if f.TeamID != nil {
		preds = append(preds, agentplugin.And(
			agentplugin.ScopeTypeEQ(agentplugin.ScopeTypeTeam),
			agentplugin.ScopeIDEQ(f.TeamID.String()),
		))
	}
	if f.UserID != nil {
		preds = append(preds, agentplugin.And(
			agentplugin.ScopeTypeEQ(agentplugin.ScopeTypeUser),
			agentplugin.ScopeIDEQ(f.UserID.String()),
		))
	}
	if len(preds) == 0 {
		return q.Where(agentplugin.IDEQ(uuid.Nil))
	}
	return q.Where(agentplugin.Or(preds...))
}

func (r *repoImpl) ListSkillsForListingScoped(ctx context.Context, f ScopeFilter) ([]*ResourceListItem, error) {
	q := r.db.AgentSkill.Query().
		Where(
			agentskill.IsDeletedEQ(false),
			agentskill.IsOrphanEQ(false),
			agentskill.ActiveVersionIDNotNil(),
		).
		Order(db.Asc(agentskill.FieldName))
	q = applyScopeSkill(q, f)

	skills, err := q.All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skills scoped: %w", err)
	}
	if len(skills) == 0 {
		return nil, nil
	}

	// name-based override: user > team > global
	skills = pickSkillByName(skills)

	versionIDs := make([]uuid.UUID, 0, len(skills))
	skillIDs := make([]uuid.UUID, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *s.ActiveVersionID)
		}
		skillIDs = append(skillIDs, s.ID)
	}

	versions, err := r.db.AgentSkillVersion.Query().
		Where(agentskillversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list skill versions scoped: %w", err)
	}
	versionByID := make(map[uuid.UUID]*db.AgentSkillVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	// groups: load all bindings for the selected skills, join team_groups
	groupsBySkill, err := r.loadSkillGroups(ctx, skillIDs)
	if err != nil {
		return nil, err
	}

	out := make([]*ResourceListItem, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*s.ActiveVersionID]
		if !ok {
			continue
		}
		desc := v.ParsedMeta.Description
		if s.Description != "" {
			desc = s.Description
		}
		if s.AdminDescription != nil && *s.AdminDescription != "" {
			desc = *s.AdminDescription
		}
		tags := v.ParsedMeta.Tags
		if s.AdminTags != nil {
			tags = s.AdminTags
		}
		out = append(out, &ResourceListItem{
			ID:              s.ID,
			Name:            s.Name,
			Description:     desc,
			Version:         v.Version,
			IsForceDelivery: s.IsForceDelivery,
			Tags:            tags,
			Categories:      v.ParsedMeta.Categories,
			Enabled:         s.Enabled,
			ScopeType:       string(s.ScopeType),
			ScopeID:         s.ScopeID,
			Groups:          groupsBySkill[s.ID],
		})
	}
	return out, nil
}

func (r *repoImpl) ListPluginsForListingScoped(ctx context.Context, f ScopeFilter) ([]*ResourceListItem, error) {
	q := r.db.AgentPlugin.Query().
		Where(
			agentplugin.IsDeletedEQ(false),
			agentplugin.IsOrphanEQ(false),
			agentplugin.ActiveVersionIDNotNil(),
		).
		Order(db.Asc(agentplugin.FieldName))
	q = applyScopePlugin(q, f)

	plugins, err := q.All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins scoped: %w", err)
	}
	if len(plugins) == 0 {
		return nil, nil
	}
	plugins = pickPluginByName(plugins)

	versionIDs := make([]uuid.UUID, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *p.ActiveVersionID)
		}
	}
	versions, err := r.db.AgentPluginVersion.Query().
		Where(agentpluginversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugin versions scoped: %w", err)
	}
	versionByID := make(map[uuid.UUID]*db.AgentPluginVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*ResourceListItem, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*p.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &ResourceListItem{
			ID:              p.ID,
			Name:            p.Name,
			Description:     p.Description,
			Version:         v.Version,
			IsForceDelivery: p.IsForceDelivery,
			Entry:           v.ParsedMeta.Entry,
			Enabled:         p.Enabled,
			ScopeType:       string(p.ScopeType),
			ScopeID:         p.ScopeID,
		})
	}
	return out, nil
}

func (r *repoImpl) ListActiveSkillsScoped(ctx context.Context, sel SkillSelection) ([]*SkillWithVersion, error) {
	q := r.db.AgentSkill.Query().
		Where(
			agentskill.IsDeletedEQ(false),
			agentskill.IsOrphanEQ(false),
			agentskill.EnabledEQ(true),
			agentskill.ActiveVersionIDNotNil(),
		)
	q = applyScopeSkill(q, sel.Scope)

	if len(sel.UserSelectedIDs) == 0 {
		q = q.Where(agentskill.IsForceDeliveryEQ(true))
	} else {
		q = q.Where(agentskill.Or(
			agentskill.IDIn(sel.UserSelectedIDs...),
			agentskill.IsForceDeliveryEQ(true),
		))
	}

	skills, err := q.Order(db.Asc(agentskill.FieldName)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list active skills scoped: %w", err)
	}
	if len(skills) == 0 {
		return nil, nil
	}
	skills = pickSkillByName(skills)

	versionIDs := make([]uuid.UUID, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *s.ActiveVersionID)
		}
	}
	versions, err := r.db.AgentSkillVersion.Query().
		Where(agentskillversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list active skill versions scoped: %w", err)
	}
	versionByID := make(map[uuid.UUID]*db.AgentSkillVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*SkillWithVersion, 0, len(skills))
	for _, s := range skills {
		if s.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*s.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &SkillWithVersion{
			ID:              s.ID,
			Name:            s.Name,
			Description:     s.Description,
			Version:         v.Version,
			S3Key:           v.S3Key,
			IsForceDelivery: s.IsForceDelivery,
			IsOrphan:        s.IsOrphan,
			ParsedMeta:      v.ParsedMeta,
			UpdatedAt:       s.UpdatedAt,
		})
	}
	return out, nil
}

func (r *repoImpl) ListActivePluginsScoped(ctx context.Context, sel SkillSelection) ([]*PluginWithVersion, error) {
	q := r.db.AgentPlugin.Query().
		Where(
			agentplugin.IsDeletedEQ(false),
			agentplugin.IsOrphanEQ(false),
			agentplugin.EnabledEQ(true),
			agentplugin.ActiveVersionIDNotNil(),
		)
	q = applyScopePlugin(q, sel.Scope)

	if len(sel.UserSelectedIDs) == 0 {
		q = q.Where(agentplugin.IsForceDeliveryEQ(true))
	} else {
		q = q.Where(agentplugin.Or(
			agentplugin.IDIn(sel.UserSelectedIDs...),
			agentplugin.IsForceDeliveryEQ(true),
		))
	}

	plugins, err := q.Order(db.Asc(agentplugin.FieldName)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list active plugins scoped: %w", err)
	}
	if len(plugins) == 0 {
		return nil, nil
	}
	plugins = pickPluginByName(plugins)

	versionIDs := make([]uuid.UUID, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *p.ActiveVersionID)
		}
	}
	versions, err := r.db.AgentPluginVersion.Query().
		Where(agentpluginversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list active plugin versions scoped: %w", err)
	}
	versionByID := make(map[uuid.UUID]*db.AgentPluginVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*PluginWithVersion, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*p.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &PluginWithVersion{
			ID:              p.ID,
			Name:            p.Name,
			Description:     p.Description,
			Version:         v.Version,
			S3Key:           v.S3Key,
			IsForceDelivery: p.IsForceDelivery,
			IsOrphan:        p.IsOrphan,
			Entry:           v.ParsedMeta.Entry,
			UpdatedAt:       p.UpdatedAt,
		})
	}
	return out, nil
}

// loadSkillGroups joins agent_skill_group_bindings + team_groups to return
// per-skill group refs. Skills without any binding are absent from the map.
func (r *repoImpl) loadSkillGroups(ctx context.Context, skillIDs []uuid.UUID) (map[uuid.UUID][]ResourceGroupRef, error) {
	if len(skillIDs) == 0 {
		return map[uuid.UUID][]ResourceGroupRef{}, nil
	}
	bindings, err := r.db.AgentSkillGroupBinding.Query().
		Where(agentskillgroupbinding.SkillIDIn(skillIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: load skill groups: %w", err)
	}
	if len(bindings) == 0 {
		return map[uuid.UUID][]ResourceGroupRef{}, nil
	}
	groupIDSet := make(map[uuid.UUID]struct{})
	for _, b := range bindings {
		groupIDSet[b.GroupID] = struct{}{}
	}
	groupIDs := make([]uuid.UUID, 0, len(groupIDSet))
	for id := range groupIDSet {
		groupIDs = append(groupIDs, id)
	}
	groups, err := r.db.TeamGroup.Query().
		Where(teamgroup.IDIn(groupIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: load groups: %w", err)
	}
	groupByID := make(map[uuid.UUID]*db.TeamGroup, len(groups))
	for _, g := range groups {
		groupByID[g.ID] = g
	}
	out := make(map[uuid.UUID][]ResourceGroupRef, len(skillIDs))
	for _, b := range bindings {
		g, ok := groupByID[b.GroupID]
		if !ok {
			continue
		}
		out[b.SkillID] = append(out[b.SkillID], ResourceGroupRef{ID: g.ID, Name: g.Name})
	}
	return out, nil
}

func (r *repoImpl) ListPluginsForListing(ctx context.Context) ([]*ResourceListItem, error) {
	plugins, err := r.db.AgentPlugin.Query().
		Where(
			agentplugin.IsDeletedEQ(false),
			agentplugin.IsOrphanEQ(false),
			agentplugin.ActiveVersionIDNotNil(),
		).
		Order(db.Asc(agentplugin.FieldName)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugins for listing: %w", err)
	}
	if len(plugins) == 0 {
		return nil, nil
	}

	versionIDs := make([]uuid.UUID, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID != nil {
			versionIDs = append(versionIDs, *p.ActiveVersionID)
		}
	}

	versions, err := r.db.AgentPluginVersion.Query().
		Where(agentpluginversion.IDIn(versionIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentresource: list plugin versions for listing: %w", err)
	}

	versionByID := make(map[uuid.UUID]*db.AgentPluginVersion, len(versions))
	for _, v := range versions {
		versionByID[v.ID] = v
	}

	out := make([]*ResourceListItem, 0, len(plugins))
	for _, p := range plugins {
		if p.ActiveVersionID == nil {
			continue
		}
		v, ok := versionByID[*p.ActiveVersionID]
		if !ok {
			continue
		}
		out = append(out, &ResourceListItem{
			ID:              p.ID,
			Name:            p.Name,
			Description:     p.Description,
			Version:         v.Version,
			IsForceDelivery: p.IsForceDelivery,
			Entry:           v.ParsedMeta.Entry,
		})
	}
	return out, nil
}
