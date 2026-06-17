package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

// TeamSkill 团队私有 skill 的 DTO,对应 agent_skill 在 scope_type=team 下的一行
// + 其 active_version 的元数据 + 团队分组关联。
type TeamSkill struct {
	ID              uuid.UUID       `json:"id"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Tags            []string        `json:"tags"`
	Categories      []string        `json:"categories,omitempty"`
	Content         string          `json:"content"` // SKILL.md 文本,从 active version 当时入库时记录
	ActiveVersion   string          `json:"active_version,omitempty"`
	S3Key           string          `json:"s3_key,omitempty"`
	IsForceDelivery bool            `json:"is_force_delivery"`
	Enabled         bool            `json:"enabled"`
	SkillMDPath     string          `json:"skill_md_path,omitempty"`
	SourceType      string          `json:"source_type,omitempty"`
	SourceLabel     string          `json:"source_label,omitempty"`
	Groups          []SkillGroupRef `json:"groups"`
	CreatedAt       int64           `json:"created_at"`
	UpdatedAt       int64           `json:"updated_at"`
}

// TeamSkillUsecase 是团队管理员侧的 skill CRUD 接口。
type TeamSkillUsecase interface {
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamSkillsResp, error)
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamSkillReq) (*TeamSkill, error)
	AddPackage(ctx context.Context, teamUser *TeamUser, req *AddTeamSkillPackageReq) (*TeamSkill, error)
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamSkillReq) (*TeamSkill, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamSkillReq) error
}

// TeamSkillRepo 是 usecase 用来读写 agent_skill+version+group_bindings 的接口。
type TeamSkillRepo interface {
	List(ctx context.Context, teamID uuid.UUID) ([]*db.AgentSkill, error)
	// GetSkill 取单个 team scope 下的 agent_skill 行(变更后回包完整 DTO 用)。
	GetSkill(ctx context.Context, teamID, skillID uuid.UUID) (*db.AgentSkill, error)
	GetBareRepoID(ctx context.Context, teamID uuid.UUID) (uuid.UUID, error)
	// UpsertSkill 在 bare repo 下按 (repo_id, name) upsert agent_skill;
	// 不存在则创建,存在则原样返回(更新由 Update / new version 走单独路径)。
	UpsertSkill(ctx context.Context, teamID, repoID, userID uuid.UUID, name, description string, isForceDelivery bool, extensionPackageID string) (*db.AgentSkill, error)
	// CreateVersion 写一行 agent_skill_versions 并把 agent_skill.active_version_id 切到新版本。
	// version 字符串由 usecase 计算(典型 v1/v2/v3)。
	CreateVersion(ctx context.Context, skillID uuid.UUID, version, s3Key string, meta SkillVersionMeta) (*db.AgentSkillVersion, error)
	// UpdateMeta 改 agent_skill 行的 name / description / is_force_delivery
	// (不产生新版本)。name 为空字符串时不改名,避免误清空。
	UpdateMeta(ctx context.Context, teamID, skillID uuid.UUID, name string, description *string, isForceDelivery *bool) (*db.AgentSkill, error)
	// UpdateActiveVersionTags 原地更新 active version 的 parsed_meta.tags
	// (不建新版本),供"只改元数据"路径持久化标签编辑。skill 无 active
	// version 时为 no-op。
	UpdateActiveVersionTags(ctx context.Context, skillID uuid.UUID, tags []string) error
	// SoftDeleteSkill 仅软删 agent_skill 行(repo 不动)。
	SoftDeleteSkill(ctx context.Context, teamID, skillID uuid.UUID) error
	// ReplaceGroupBindings 用 groupIDs 全量替换 skill ↔ team_group 的关联。
	ReplaceGroupBindings(ctx context.Context, teamID, skillID uuid.UUID, groupIDs []uuid.UUID) error
	// GetActiveVersion 加载 agent_skill 的当前 active_version_id 对应行。
	GetActiveVersion(ctx context.Context, skillID uuid.UUID) (*db.AgentSkillVersion, error)
	// NextVersionFor 计算 agent_skill 下一个版本号("v{N+1}")。
	NextVersionFor(ctx context.Context, skillID uuid.UUID) (string, error)
	// LoadGroups 返回 skill 关联的 team_group(只返回 id + name)。
	LoadGroups(ctx context.Context, skillID uuid.UUID) ([]SkillGroupRef, error)
}

// SkillVersionMeta 写 agent_skill_versions.parsed_meta 时用。
// description 仍写到 agent_skill 行,这里只放 frontmatter 派生 + 创作来源字段。
type SkillVersionMeta struct {
	Description string
	Categories  []string
	Tags        []string
	SourceType  string
	SourceLabel string
}

// AddTeamSkillReq 团队管理员用 JSON 直接传 SKILL.md 文本,后端打包成 zip。
// is_force_delivery 字段允许传(团队管理员 UI 不展示,但平台管理员可通过
// mcai-admin-new 直写 DB,语义上保留 path),默认 false。
type AddTeamSkillReq struct {
	Name            string      `json:"name" validate:"required"`
	Description     string      `json:"description" validate:"required"`
	Tags            []string    `json:"tags" validate:"omitempty"`
	Content         string      `json:"content" validate:"required"` // SKILL.md 原文
	GroupIDs        []uuid.UUID `json:"group_ids" validate:"omitempty"`
	SkillMDPath     string      `json:"skill_md_path" validate:"omitempty"`
	IsForceDelivery bool        `json:"is_force_delivery,omitempty"`
	// SourceType ∈ {"zip","markdown","text"};SourceLabel 为文件名或 "粘贴文本"。
	// 纯展示元数据,存进 active version 的 parsed_meta。
	SourceType         string `json:"source_type" validate:"omitempty"`
	SourceLabel        string `json:"source_label" validate:"omitempty"`
	ExtensionPackageID string `json:"extension_package_id,omitempty" swaggerignore:"true"`
}

// AddTeamSkillPackageReq multipart 上传:从 zip 包里解 SKILL.md 验证,frontmatter
// 解出 tags 时 form 字段(若 present)覆盖。
type AddTeamSkillPackageReq struct {
	AddTeamSkillReq
	PackageFilename string `json:"-" swaggerignore:"true"`
	PackageData     []byte `json:"-" swaggerignore:"true"`
}

type ListTeamSkillsResp struct {
	Skills []*TeamSkill `json:"skills"`
}

// UpdateTeamSkillReq D3 语义:Content 非空 = 内容变更 → 建新版本;否则只改元数据。
type UpdateTeamSkillReq struct {
	SkillID         uuid.UUID   `param:"skill_id" validate:"required" json:"-" swaggerignore:"true"`
	Name            string      `json:"name" validate:"omitempty"`        // 当前不允许改 name(unique 索引硬约束),保留位
	Description     *string     `json:"description" validate:"omitempty"`
	Tags            []string    `json:"tags" validate:"omitempty"`
	Content         string      `json:"content" validate:"omitempty"`
	GroupIDs        []uuid.UUID `json:"group_ids" validate:"omitempty"`
	SkillMDPath     *string     `json:"skill_md_path,omitempty" validate:"omitempty"`
	IsForceDelivery *bool       `json:"is_force_delivery,omitempty"`
	SourceType      *string     `json:"source_type,omitempty" validate:"omitempty"`
	SourceLabel     *string     `json:"source_label,omitempty" validate:"omitempty"`
}

type DeleteTeamSkillReq struct {
	SkillID uuid.UUID `param:"skill_id" validate:"required" json:"-" swaggerignore:"true"`
}
