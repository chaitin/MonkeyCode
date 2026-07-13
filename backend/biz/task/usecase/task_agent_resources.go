package usecase

import "github.com/chaitin/MonkeyCode/backend/domain"

// fillAgentResourceBaseline 把落库的基线填进 domain.Task.Extra（cvt 不映射嵌套字段）。
// tk.Extra 为 nil 时初始化；只赋 SkillIDs/PluginIDs 两个字段，不覆盖 Extra 其他字段。
func fillAgentResourceBaseline(tk *domain.Task, skillIDs, pluginIDs []string) {
	if tk.Extra == nil {
		tk.Extra = &domain.TaskExtraConfig{}
	}
	tk.Extra.SkillIDs = skillIDs
	tk.Extra.PluginIDs = pluginIDs
}
