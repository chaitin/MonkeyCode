package agentresource

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentplugin"
	"github.com/chaitin/MonkeyCode/backend/db/agentpluginversion"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/db/agentruleversion"
	"github.com/chaitin/MonkeyCode/backend/db/agentskill"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillversion"
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
