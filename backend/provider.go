package backend

import (
	"github.com/google/wire"

	modelrepo "github.com/chaitin/MonkeyCode/backend/internal/model/repo"
	proxyrepo "github.com/chaitin/MonkeyCode/backend/internal/proxy/repo"
	proxyusecase "github.com/chaitin/MonkeyCode/backend/internal/proxy/usecase"
	securityrepo "github.com/chaitin/MonkeyCode/backend/internal/security/repo"
	userrepo "github.com/chaitin/MonkeyCode/backend/internal/user/repo"
	userusecase "github.com/chaitin/MonkeyCode/backend/internal/user/usecase"
)

var Provider = wire.NewSet(
	proxyusecase.NewProxyUsecase,
	proxyrepo.NewProxyRepo,
	userusecase.NewUserUsecase,
	userrepo.NewUserRepo,
	modelrepo.NewModelRepo,
	securityrepo.NewSecurityScanningRepo,
)
