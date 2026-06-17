// Package repo — 团队管理员侧的 agent_skill CRUD,对应 docs/skill-architecture.md
// 中"团队管理员通过团队后台手动上传"的链路。
//
// 所有写入都把 skill 挂到 team 的 bare repo 下(scope_type=team, source_type=bare),
// agent_skill_versions 走标准的 active_version_id 切换语义,group bindings 用
// agent_skill_group_bindings 表显式 join。
package repo

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentskill"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillgroupbinding"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillrepo"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillversion"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamSkillRepo struct {
	client *db.Client
}

// NewTeamSkillRepo 注入 ent client。
func NewTeamSkillRepo(i *do.Injector) (domain.TeamSkillRepo, error) {
	return &teamSkillRepo{client: do.MustInvoke[*db.Client](i)}, nil
}

func (r *teamSkillRepo) List(ctx context.Context, teamID uuid.UUID) ([]*db.AgentSkill, error) {
	repoID, err := r.GetBareRepoID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	return r.client.AgentSkill.Query().
		Where(
			agentskill.RepoIDEQ(repoID),
			agentskill.IsDeletedEQ(false),
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeTeam),
			agentskill.ScopeIDEQ(teamID.String()),
		).
		Order(db.Asc(agentskill.FieldName)).
		All(ctx)
}

func (r *teamSkillRepo) GetSkill(ctx context.Context, teamID, skillID uuid.UUID) (*db.AgentSkill, error) {
	return r.client.AgentSkill.Query().
		Where(
			agentskill.IDEQ(skillID),
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeTeam),
			agentskill.ScopeIDEQ(teamID.String()),
			agentskill.IsDeletedEQ(false),
		).
		First(ctx)
}

func (r *teamSkillRepo) GetBareRepoID(ctx context.Context, teamID uuid.UUID) (uuid.UUID, error) {
	row, err := r.client.AgentSkillRepo.Query().
		Where(
			agentskillrepo.ScopeTypeEQ(agentskillrepo.ScopeTypeTeam),
			agentskillrepo.ScopeIDEQ(teamID.String()),
			agentskillrepo.SourceTypeEQ(agentskillrepo.SourceTypeBare),
			agentskillrepo.IsDeletedEQ(false),
		).
		First(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("team_skill_repo: bare repo missing for team %s: %w", teamID, err)
	}
	return row.ID, nil
}

func (r *teamSkillRepo) UpsertSkill(ctx context.Context, teamID, repoID, userID uuid.UUID, name, description string, isForceDelivery bool, extensionPackageID string) (*db.AgentSkill, error) {
	existing, err := r.client.AgentSkill.Query().
		Where(
			agentskill.RepoIDEQ(repoID),
			agentskill.NameEQ(name),
			agentskill.IsDeletedEQ(false),
		).
		First(ctx)
	if err == nil {
		return existing, nil
	}
	if !db.IsNotFound(err) {
		return nil, err
	}
	return r.client.AgentSkill.Create().
		SetID(uuid.New()).
		SetRepoID(repoID).
		SetName(name).
		SetDescription(description).
		SetScopeType(agentskill.ScopeTypeTeam).
		SetScopeID(teamID.String()).
		SetCreatedBy(userID).
		SetIsForceDelivery(isForceDelivery).
		SetEnabled(true).
		SetNillableExtensionPackageID(nillableString(extensionPackageID)).
		Save(ctx)
}

func (r *teamSkillRepo) CreateVersion(ctx context.Context, skillID uuid.UUID, version, s3Key string, meta domain.SkillVersionMeta) (*db.AgentSkillVersion, error) {
	var out *db.AgentSkillVersion
	err := entx.WithTx2(ctx, r.client, func(tx *db.Tx) error {
		v, err := tx.AgentSkillVersion.Create().
			SetID(uuid.New()).
			SetResourceID(skillID).
			SetVersion(version).
			SetS3Key(s3Key).
			SetParsedMeta(types.SkillParsedMeta{
				Description: meta.Description,
				Categories:  meta.Categories,
				Tags:        meta.Tags,
				SourceType:  meta.SourceType,
				SourceLabel: meta.SourceLabel,
			}).
			Save(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.AgentSkill.UpdateOneID(skillID).
			SetActiveVersionID(v.ID).
			SetUpdatedAt(time.Now()).
			Save(ctx); err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
}

func (r *teamSkillRepo) UpdateMeta(ctx context.Context, teamID, skillID uuid.UUID, name string, description *string, isForceDelivery *bool) (*db.AgentSkill, error) {
	u := r.client.AgentSkill.UpdateOneID(skillID).
		Where(
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeTeam),
			agentskill.ScopeIDEQ(teamID.String()),
			agentskill.IsDeletedEQ(false),
		).
		SetUpdatedAt(time.Now())
	if strings.TrimSpace(name) != "" {
		u = u.SetName(name)
	}
	if description != nil {
		u = u.SetDescription(*description)
	}
	if isForceDelivery != nil {
		u = u.SetIsForceDelivery(*isForceDelivery)
	}
	return u.Save(ctx)
}

func (r *teamSkillRepo) UpdateActiveVersionTags(ctx context.Context, skillID uuid.UUID, tags []string) error {
	skill, err := r.client.AgentSkill.Get(ctx, skillID)
	if err != nil {
		return err
	}
	if skill.ActiveVersionID == nil {
		return nil
	}
	ver, err := r.client.AgentSkillVersion.Get(ctx, *skill.ActiveVersionID)
	if err != nil {
		return err
	}
	meta := ver.ParsedMeta
	meta.Tags = tags
	_, err = r.client.AgentSkillVersion.UpdateOneID(ver.ID).
		SetParsedMeta(meta).
		Save(ctx)
	return err
}

func (r *teamSkillRepo) SoftDeleteSkill(ctx context.Context, teamID, skillID uuid.UUID) error {
	_, err := r.client.AgentSkill.UpdateOneID(skillID).
		Where(
			agentskill.ScopeTypeEQ(agentskill.ScopeTypeTeam),
			agentskill.ScopeIDEQ(teamID.String()),
		).
		SetIsDeleted(true).
		SetUpdatedAt(time.Now()).
		Save(ctx)
	return err
}

func (r *teamSkillRepo) ReplaceGroupBindings(ctx context.Context, teamID, skillID uuid.UUID, groupIDs []uuid.UUID) error {
	// 仅在 group_id 属于该 team 时才接受,防止跨 team 越权关联。
	if len(groupIDs) > 0 {
		cnt, err := r.client.TeamGroup.Query().
			Where(teamgroup.IDIn(groupIDs...), teamgroup.TeamIDEQ(teamID)).
			Count(ctx)
		if err != nil {
			return err
		}
		if cnt != len(groupIDs) {
			return fmt.Errorf("team_skill_repo: some group ids do not belong to team %s", teamID)
		}
	}
	return entx.WithTx2(ctx, r.client, func(tx *db.Tx) error {
		if _, err := tx.AgentSkillGroupBinding.Delete().
			Where(agentskillgroupbinding.SkillIDEQ(skillID)).
			Exec(ctx); err != nil {
			return err
		}
		for _, gid := range groupIDs {
			if _, err := tx.AgentSkillGroupBinding.Create().
				SetID(uuid.New()).
				SetSkillID(skillID).
				SetGroupID(gid).
				Save(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *teamSkillRepo) GetActiveVersion(ctx context.Context, skillID uuid.UUID) (*db.AgentSkillVersion, error) {
	skill, err := r.client.AgentSkill.Get(ctx, skillID)
	if err != nil {
		return nil, err
	}
	if skill.ActiveVersionID == nil {
		return nil, nil
	}
	return r.client.AgentSkillVersion.Get(ctx, *skill.ActiveVersionID)
}

func (r *teamSkillRepo) NextVersionFor(ctx context.Context, skillID uuid.UUID) (string, error) {
	versions, err := r.client.AgentSkillVersion.Query().
		Where(agentskillversion.ResourceIDEQ(skillID)).
		All(ctx)
	if err != nil {
		return "", err
	}
	max := 0
	for _, v := range versions {
		// version 形如 "v3" / "v10";容错:非 vN 形式跳过。
		s := strings.TrimPrefix(v.Version, "v")
		n, err := strconv.Atoi(s)
		if err != nil {
			continue
		}
		if n > max {
			max = n
		}
	}
	return fmt.Sprintf("v%d", max+1), nil
}

func (r *teamSkillRepo) LoadGroups(ctx context.Context, skillID uuid.UUID) ([]domain.SkillGroupRef, error) {
	bindings, err := r.client.AgentSkillGroupBinding.Query().
		Where(agentskillgroupbinding.SkillIDEQ(skillID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	if len(bindings) == 0 {
		return nil, nil
	}
	groupIDs := make([]uuid.UUID, 0, len(bindings))
	for _, b := range bindings {
		groupIDs = append(groupIDs, b.GroupID)
	}
	groups, err := r.client.TeamGroup.Query().
		Where(teamgroup.IDIn(groupIDs...)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]domain.SkillGroupRef, 0, len(groups))
	for _, g := range groups {
		out = append(out, domain.SkillGroupRef{ID: g.ID.String(), Name: g.Name})
	}
	return out, nil
}

// agentresource 引用仅用于 enum 字符串常量校验/IDE 跳转;实际未使用。
func nillableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

var _ = agentresource.BareRepoSourceType
