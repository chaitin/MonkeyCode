package setting

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/setting/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/setting/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/setting/usecase"
)

// RegisterSetting 注册 setting 模块（个人模型和镜像配置）
func RegisterSetting(i *do.Injector) {
	do.Provide(i, repo.NewModelRepo)
	do.Provide(i, repo.NewImageRepo)
	do.Provide(i, usecase.NewModelUsecase)
	do.Provide(i, usecase.NewImageUsecase)
	do.Provide(i, v1.NewModelHandler)
	do.Provide(i, v1.NewImageHandler)
	do.MustInvoke[*v1.ModelHandler](i)
	do.MustInvoke[*v1.ImageHandler](i)
}
