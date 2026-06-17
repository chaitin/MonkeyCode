package domain

// SkillListItem 公共 skill 列表项（/api/v1/skills），由 agentresource.Repo
// 从 DB 读取，无文件系统依赖。
//
// 三级 scope (global/team/user) 并集 + name 覆盖(user > team > global) 后返
// 回;disabled 的 skill 仍会出现在列表里(Enabled=false),由前端灰显但不允许
// 勾选(选了 dispatch 端也会跳过)。
type SkillListItem struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Description     string             `json:"description"`
	Tags            []string           `json:"tags"`
	Categories      []string           `json:"categories,omitempty"`
	ActiveVersion   string             `json:"active_version,omitempty"`
	IsForceDelivery bool               `json:"is_force_delivery"`
	Enabled         bool               `json:"enabled"`
	Scope           SkillScope         `json:"scope"`
	Groups          []SkillGroupRef    `json:"groups,omitempty"`
}

// SkillScope 显示这个 skill 来自哪一层 (global/team/user) 以及对应 id。
type SkillScope struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// SkillGroupRef 仅 scope=team 的 skill 会带,用于在前端展示"分享给哪些分组"。
type SkillGroupRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
