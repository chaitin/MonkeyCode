package backend

import (
	"github.com/google/wire"

	proxyusecase "github.com/chaitin/MonkeyCode/backend/internal/proxy/usecase"
	userusecase "github.com/chaitin/MonkeyCode/backend/internal/user/usecase"
)

var Provider = wire.NewSet(
	proxyusecase.NewProxyUsecase,
	userusecase.NewUserUsecase,
)
