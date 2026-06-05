package domain

// SkillListItem 公共 skill 列表项（/api/v1/skills），由 agentresource.Repo
// 从 DB 读取，无文件系统依赖。
type SkillListItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	ActiveVersion   string `json:"active_version,omitempty"`
	IsForceDelivery bool   `json:"is_force_delivery"`
}
