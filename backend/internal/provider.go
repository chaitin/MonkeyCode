package internal

import (
	"github.com/google/wire"

	billingv1 "github.com/chaitin/MonkeyCode/backend/internal/billing/handler/http/v1"
	billingrepo "github.com/chaitin/MonkeyCode/backend/internal/billing/repo"
	billingusecase "github.com/chaitin/MonkeyCode/backend/internal/billing/usecase"
	dashv1 "github.com/chaitin/MonkeyCode/backend/internal/dashboard/handler/v1"
	dashrepo "github.com/chaitin/MonkeyCode/backend/internal/dashboard/repo"
	dashusecase "github.com/chaitin/MonkeyCode/backend/internal/dashboard/usecase"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
	modelv1 "github.com/chaitin/MonkeyCode/backend/internal/model/handler/http/v1"
	modelrepo "github.com/chaitin/MonkeyCode/backend/internal/model/repo"
	modelusecase "github.com/chaitin/MonkeyCode/backend/internal/model/usecase"
	v1 "github.com/chaitin/MonkeyCode/backend/internal/openai/handler/v1"
	openairepo "github.com/chaitin/MonkeyCode/backend/internal/openai/repo"
	openai "github.com/chaitin/MonkeyCode/backend/internal/openai/usecase"
	"github.com/chaitin/MonkeyCode/backend/internal/proxy"
	proxyrepo "github.com/chaitin/MonkeyCode/backend/internal/proxy/repo"
	proxyusecase "github.com/chaitin/MonkeyCode/backend/internal/proxy/usecase"
	userV1 "github.com/chaitin/MonkeyCode/backend/internal/user/handler/v1"
	userrepo "github.com/chaitin/MonkeyCode/backend/internal/user/repo"
	userusecase "github.com/chaitin/MonkeyCode/backend/internal/user/usecase"
)

var Provider = wire.NewSet(
	proxy.NewLLMProxy,
	v1.NewV1Handler,
	openai.NewOpenAIUsecase,
	openairepo.NewOpenAIRepo,
	modelv1.NewModelHandler,
	proxyusecase.NewProxyUsecase,
	proxyrepo.NewProxyRepo,
	modelusecase.NewModelUsecase,
	modelrepo.NewModelRepo,
	dashv1.NewDashboardHandler,
	dashusecase.NewDashboardUsecase,
	dashrepo.NewDashboardRepo,
	middleware.NewProxyMiddleware,
	middleware.NewAuthMiddleware,
	userV1.NewUserHandler,
	userrepo.NewUserRepo,
	userusecase.NewUserUsecase,
	billingv1.NewBillingHandler,
	billingrepo.NewBillingRepo,
	billingusecase.NewBillingUsecase,
)
