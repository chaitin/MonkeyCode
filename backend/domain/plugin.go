package domain

// PluginListItem 公共 plugin 列表项（/api/v1/plugins），仅 OpenCode 任务真正下发。
//
// 同 SkillListItem,三级 scope 并集 + 覆盖,Enabled=false 仍展示;Groups 留空
// (plugin 没有团队管理员上传 UI)。
type PluginListItem struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	Entry           string     `json:"entry"`
	ActiveVersion   string     `json:"active_version,omitempty"`
	IsForceDelivery bool       `json:"is_force_delivery"`
	Enabled         bool       `json:"enabled"`
	Scope           SkillScope `json:"scope"`
}
