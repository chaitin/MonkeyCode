package agentresource

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentpluginrepo"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillrepo"
)

// BareRepoSourceType / BareRepoScopeType 与 ent enum 字符串严格保持一致。
const (
	BareRepoSourceType      = "bare"
	BareRepoScopeTypeTeam   = "team"
	BareRepoScopeTypeGlobal = "global"
)

// teamBareRepoName 生成 bare repo 的展示名,与 docs/skill-architecture.md §3
// 锁定的命名一致(`team-<team_id>`)。
func teamBareRepoName(teamID uuid.UUID) string {
	return fmt.Sprintf("team-%s", teamID.String())
}

// EnsureTeamBareReposTx 保证给定 team 存在恰好一个 bare skill_repo 与一个 bare
// plugin_repo(对应 docs/skill-architecture.md §3 中的 provision 钩子)。
// 幂等:已存在则原样返回(不重复创建,不更新);不存在则插入。
// 必须在事务内调用,事务由调用方持有(典型场景是 InitTeam 的事务尾部)。
func EnsureTeamBareReposTx(ctx context.Context, tx *db.Tx, teamID, createdBy uuid.UUID) (*db.AgentSkillRepo, *db.AgentPluginRepo, error) {
	scopeID := teamID.String()

	skillRepo, err := ensureTeamBareSkillRepo(ctx, tx, teamID, scopeID, createdBy)
	if err != nil {
		return nil, nil, fmt.Errorf("ensure bare skill repo: %w", err)
	}
	pluginRepo, err := ensureTeamBarePluginRepo(ctx, tx, teamID, scopeID, createdBy)
	if err != nil {
		return nil, nil, fmt.Errorf("ensure bare plugin repo: %w", err)
	}
	return skillRepo, pluginRepo, nil
}

func ensureTeamBareSkillRepo(ctx context.Context, tx *db.Tx, teamID uuid.UUID, scopeID string, createdBy uuid.UUID) (*db.AgentSkillRepo, error) {
	existing, err := tx.AgentSkillRepo.Query().
		Where(
			agentskillrepo.ScopeTypeEQ(agentskillrepo.ScopeTypeTeam),
			agentskillrepo.ScopeIDEQ(scopeID),
			agentskillrepo.SourceTypeEQ(agentskillrepo.SourceTypeBare),
			agentskillrepo.IsDeletedEQ(false),
		).
		First(ctx)
	if err == nil {
		return existing, nil
	}
	if !db.IsNotFound(err) {
		return nil, err
	}
	return tx.AgentSkillRepo.Create().
		SetID(uuid.New()).
		SetName(teamBareRepoName(teamID)).
		SetScopeType(agentskillrepo.ScopeTypeTeam).
		SetScopeID(scopeID).
		SetCreatedBy(createdBy).
		SetSourceType(agentskillrepo.SourceTypeBare).
		Save(ctx)
}

func ensureTeamBarePluginRepo(ctx context.Context, tx *db.Tx, teamID uuid.UUID, scopeID string, createdBy uuid.UUID) (*db.AgentPluginRepo, error) {
	existing, err := tx.AgentPluginRepo.Query().
		Where(
			agentpluginrepo.ScopeTypeEQ(agentpluginrepo.ScopeTypeTeam),
			agentpluginrepo.ScopeIDEQ(scopeID),
			agentpluginrepo.SourceTypeEQ(agentpluginrepo.SourceTypeBare),
			agentpluginrepo.IsDeletedEQ(false),
		).
		First(ctx)
	if err == nil {
		return existing, nil
	}
	if !db.IsNotFound(err) {
		return nil, err
	}
	return tx.AgentPluginRepo.Create().
		SetID(uuid.New()).
		SetName(teamBareRepoName(teamID)).
		SetScopeType(agentpluginrepo.ScopeTypeTeam).
		SetScopeID(scopeID).
		SetCreatedBy(createdBy).
		SetSourceType(agentpluginrepo.SourceTypeBare).
		Save(ctx)
}
