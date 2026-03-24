package file

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/file/handler/v1"
)

// RegisterFile 注册文件管理模块
func RegisterFile(i *do.Injector) {
	do.Provide(i, v1.NewFileHandler)
	do.MustInvoke[*v1.FileHandler](i)
}
