package subscription

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/subscription/handler/v1"
)

func ProvideSubscription(i *do.Injector) {
	do.Provide(i, v1.NewHandler)
}

func InvokeSubscription(i *do.Injector) {
	do.MustInvoke[*v1.Handler](i)
}
