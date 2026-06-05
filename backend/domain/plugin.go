package domain

// PluginListItem 公共 plugin 列表项（/api/v1/plugins），仅 OpenCode 任务真正下发。
type PluginListItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Entry           string `json:"entry"`
	ActiveVersion   string `json:"active_version,omitempty"`
	IsForceDelivery bool   `json:"is_force_delivery"`
}
