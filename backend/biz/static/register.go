package static

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/static/handler"
)

func ProviderStatic(i *do.Injector) {
	do.Provide(i, handler.NewStaticHandler)
	handler.NewStaticHandler(i)
}

func InvokeStatic(i *do.Injector) {
	do.MustInvoke[*handler.StaticHandler](i)
}
