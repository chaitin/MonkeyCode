package extension

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Branding interface {
	PublicValue(context.Context) (json.RawMessage, error)
	Value(context.Context) (json.RawMessage, error)
	AdminValue(context.Context, json.RawMessage) (json.RawMessage, error)
}
type RuntimeAccess interface {
	RuntimeAllowed(context.Context, pgx.Tx, string, string) (bool, error)
}
type Commands interface {
	ExchangeAt(context.Context, string, json.RawMessage, time.Time) (any, error)
}
type RuntimeAuthorizer interface {
	ApproveRuntime(context.Context, pgx.Tx, string, string, []byte, string) (string, error)
	CheckRuntime(context.Context, pgx.Tx, string, string, []byte) error
	RevokeRuntime(context.Context, pgx.Tx, string, string) ([]string, error)
	NotifyGrantRevoked(string)
}
type RuntimeReadiness interface {
	RuntimeReady(context.Context, string, string) (bool, error)
}
type Credits interface {
	CheckComputeMode(context.Context, pgx.Tx) error
	ComputeAccount(context.Context, pgx.Tx, string, time.Time) (billing.Account, error)
	ChargeCompute(context.Context, pgx.Tx, billing.ComputeCharge) error
}
type Runtime struct {
	ServerID   string
	Authorizer RuntimeAuthorizer
	Readiness  RuntimeReadiness
	Disconnect func(string, string)
}
type Services struct {
	Pool                                                             *pgxpool.Pool
	Storage                                                          resource.Storage
	Credits                                                          Credits
	PublicURL                                                        string
	Runtime                                                          Runtime
	ImageStateDir, ImageImportDir, RuntimeReleaseDir, RuntimeVersion string
	RegistryAuthorized                                               func(*http.Request) bool
}
type Bindings struct {
	HostCounts    func(context.Context, resource.Queryer, []string) (map[string]int64, error)
	DeviceNames   func(context.Context, resource.Queryer, string, []string) (map[string]string, error)
	Pricing       billing.Pricing
	Branding      Branding
	RuntimeAccess RuntimeAccess
	Commands      Commands
}
type Module interface {
	Initialize(context.Context, Services) (Bindings, error)
	RegisterAdmin(chi.Router)
	RegisterAgent(chi.Router)
	RegisterPublic(chi.Router)
	RegisterAuth(chi.Router)
	Run(context.Context)
	Close() error
}
