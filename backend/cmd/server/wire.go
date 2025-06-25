//go:build wireinject
// +build wireinject

package main

import (
	"log/slog"

	"github.com/google/wire"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	billingv1 "github.com/chaitin/MonkeyCode/backend/internal/billing/handler/http/v1"
	dashv1 "github.com/chaitin/MonkeyCode/backend/internal/dashboard/handler/v1"
	v1 "github.com/chaitin/MonkeyCode/backend/internal/model/handler/http/v1"
	openaiV1 "github.com/chaitin/MonkeyCode/backend/internal/openai/handler/v1"
	userV1 "github.com/chaitin/MonkeyCode/backend/internal/user/handler/v1"
)

type Server struct {
	config      *config.Config
	web         *web.Web
	ent         *db.Client
	logger      *slog.Logger
	proxy       domain.Proxy
	openaiV1    *openaiV1.V1Handler
	modelV1     *v1.ModelHandler
	userV1      *userV1.UserHandler
	dashboardV1 *dashv1.DashboardHandler
	billingV1   *billingv1.BillingHandler
}

func newServer(dir string) (*Server, error) {
	wire.Build(
		wire.Struct(new(Server), "*"),
		appSet,
	)
	return &Server{}, nil
}
