package skill

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/skill/handler/v1"
)

func ProvideSkill(i *do.Injector) {
	do.Provide(i, v1.NewSkillHandler)
}

func InvokeSkill(i *do.Injector) {
	do.MustInvoke[*v1.SkillHandler](i)
}
