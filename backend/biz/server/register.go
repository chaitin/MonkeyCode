package server

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/server/handler/v1"
)

func ProvideServer(i *do.Injector) {
	do.Provide(i, v1.NewServerConfigHandler)
}

func InvokeServer(i *do.Injector) {
	do.MustInvoke[*v1.ServerConfigHandler](i)
}
