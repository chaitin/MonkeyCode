package skill

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/skill/handler/http/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/skill/usecase"
)

// ProvideSkill 注册用户态 skill 模块的服务工厂
func ProvideSkill(i *do.Injector) {
	do.Provide(i, usecase.NewUserSkillUsecase)
	do.Provide(i, v1.NewUserSkillHandler)
}

// InvokeSkill 触发 handler 初始化
func InvokeSkill(i *do.Injector) {
	do.MustInvoke[*v1.UserSkillHandler](i)
}
