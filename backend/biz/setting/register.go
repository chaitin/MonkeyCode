package setting

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/setting/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/setting/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/setting/usecase"
)

// ProvideSetting 注册 setting 模块的服务工厂
func ProvideSetting(i *do.Injector) {
	do.Provide(i, repo.NewModelRepo)
	do.Provide(i, repo.NewImageRepo)
	do.Provide(i, usecase.NewModelUsecase)
	do.Provide(i, usecase.NewImageUsecase)
	do.Provide(i, v1.NewModelHandler)
	do.Provide(i, v1.NewImageHandler)
}

// InvokeSetting 触发 setting 模块的 handler 初始化
func InvokeSetting(i *do.Injector) {
	do.MustInvoke[*v1.ModelHandler](i)
	do.MustInvoke[*v1.ImageHandler](i)
}
