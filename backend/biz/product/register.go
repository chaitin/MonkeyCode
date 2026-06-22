package product

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/product/handler/v1"
)

func ProvideProduct(i *do.Injector) {
	do.Provide(i, v1.NewVersionHandler)
}

func InvokeProduct(i *do.Injector) {
	do.MustInvoke[*v1.VersionHandler](i)
}
