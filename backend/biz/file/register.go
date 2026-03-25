package file

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/file/handler/v1"
)

// ProvideFile 注册 file 模块的服务工厂
func ProvideFile(i *do.Injector) {
	do.Provide(i, v1.NewFileHandler)
}

// InvokeFile 触发 file 模块的 handler 初始化
func InvokeFile(i *do.Injector) {
	do.MustInvoke[*v1.FileHandler](i)
}
