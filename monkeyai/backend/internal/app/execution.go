package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/extension"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type executionServices struct {
	pool           *pgxpool.Pool
	settings       *setting.Service
	sessions       *session.Service
	identities     *identity.Service
	executions     *endpoint.Execution
	keys           *apikey.Service
	charges        *billing.Service
	modelRepo      *model.Postgres
	models         *model.Service
	storage        resource.Storage
	connectors     *mcp.Service
	knowledgeBases *kb.Service
}

func (s executionServices) proxyHandler(ctx context.Context, cfg config.Config, logger *slog.Logger, registrars []AdminRegistrar) (*applicationHandler, error) {
	router := chi.NewRouter()
	router.Use(web.New(logger).Middleware)
	router.Use(relay.PreviewGuard(cfg.RuntimePreviewOriginTemplate))
	router.NotFound(web.NotFound)
	router.MethodNotAllowed(web.MethodNotAllowed)
	modelProxy := s.registerGateway(router, logger)
	endpointStore := endpoint.NewPostgres(s.pool).WithDeviceAuthorizer(s.identities)
	endpoints := endpoint.NewService(endpointStore, endpointAuth{s.identities}, logger, cfg.PublicURL).WithMaxConnections(cfg.EndpointMaxConnections)
	var runtimeRelay *relay.Service
	if cfg.RuntimeRelay {
		var err error
		runtimeRelay, err = s.attachRelay(cfg, logger, router, endpoints, endpointStore)
		if err != nil {
			return nil, err
		}
	}
	modules, bindings, err := initializeModules(ctx, registrars, extension.Services{Pool: s.pool, Credits: s.charges})
	if err != nil {
		return nil, fmt.Errorf("初始化执行授权扩展: %w", err)
	}
	for _, binding := range bindings {
		if binding.RuntimeAccess != nil {
			s.identities.WithRuntimeAccess(binding.RuntimeAccess)
		}
		if binding.DeviceNames != nil {
			endpointStore.WithNames(binding.DeviceNames)
			s.executions.WithNames(binding.DeviceNames)
		}
	}
	router.Mount("/", httpapi.New(logger, readiness{pool: s.pool, storage: s.storage, endpoints: endpoints}, chi.NewRouter(), chi.NewRouter(), chi.NewRouter()))
	return &applicationHandler{Handler: router, modules: modules, sessions: s.sessions, proxy: modelProxy, endpoints: endpoints, relay: runtimeRelay, runtimeKeys: s.keys, connectors: s.connectors}, nil
}

func (s executionServices) registerGateway(router chi.Router, logger *slog.Logger) *proxy.Proxy {
	resolver := sessionAdapter{service: s.sessions}
	p := proxy.NewProxy(modelResolver{service: s.models}, logger).
		WithRejectedUserLookup(s.keys.LookupModelUser).
		WithSessionResolver(resolver).
		WithBilling(modelBilling{service: s.charges}).
		WithUsageRecorder(modelUsageRecorder{models: s.modelRepo})
	p.Register(router)
	s.connectors.WithSessionResolver(resolver).RegisterGateway(router, s.keys, toolBilling{service: s.charges})
	s.knowledgeBases.RegisterMCP(router, s.keys)
	return p
}

func registerOAuth(router chi.Router, identities *identity.Service) {
	router.Get("/.well-known/oauth-authorization-server", identities.OAuthMetadata)
	router.Mount("/oauth", identities.OAuthRouter())
}

func relayConfig(cfg config.Config) relay.Config {
	return relay.Config{DesktopOrigins: cfg.RuntimeDesktopOrigins, PreviewOriginTemplate: cfg.RuntimePreviewOriginTemplate,
		StateDir: cfg.RuntimeStateDir, ServerID: cfg.RuntimeServerID, PublicURL: cfg.PublicURL, FilesOrigin: cfg.RuntimeFilesOrigin,
		SigningKeyFile: cfg.RuntimeSigningKeyFile, VerificationKeysFile: cfg.RuntimeVerificationKeysFile, MaxDevices: cfg.EndpointMaxConnections}
}

func (s executionServices) attachRelay(cfg config.Config, logger *slog.Logger, router chi.Router, endpoints *endpoint.Service, store *endpoint.Postgres) (*relay.Service, error) {
	r, err := relay.NewService(s.pool, s.identities, s.executions, logger, relayConfig(cfg))
	if err != nil {
		return nil, fmt.Errorf("初始化远程执行中转: %w", err)
	}
	metadata := r.Metadata()
	s.identities.WithDeviceAuthorization(metadata["server_id"].(string), r.DeviceAuthorizationKey(), s.executions)
	s.identities.WithRuntimeMetadata(metadata).WithGrantRevoker(revokeGrant(r.InvalidateGrant, s.keys))
	s.runtimeFeatures()
	s.sessions.WithRuntimeStatus(r)
	endpoints.WithRuntimeDirectory(r.Directory())
	store.WithExecutionRevoker(r.InvalidateDevice)
	if cfg.Role == config.RoleProxy {
		r.RegisterTunnel(router)
	} else {
		r.Register(router)
	}
	return r, nil
}

func (s executionServices) runtimeFeatures() {
	s.identities.WithRuntimeFeatures(func(ctx context.Context) (map[string]bool, error) {
		enabled, err := s.sessions.IndexEnabled(ctx)
		return map[string]bool{"session_index": enabled, "device_grant": true}, err
	})
}

func revokeGrant(notify func(string), keys *apikey.Service) func(string) {
	return func(id string) {
		notify(id)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := keys.RevokeRuntimeKeys(ctx, id); err != nil {
			slog.WarnContext(ctx, "撤销独立执行密钥标记失败", "grant_id", id, "error", err)
		}
	}
}

func (s executionServices) remoteRuntime(cfg config.Config, logger *slog.Logger) (*relay.Control, extension.Runtime) {
	client := relay.NewControl(cfg.RuntimeStateDir)
	s.identities.WithRuntimeMetadataSource(func() (map[string]any, error) { return relay.ReadMetadata(relayConfig(cfg)) })
	s.runtimeFeatures()
	s.sessions.WithRuntimeStatus(client)
	s.identities.WithDeviceAuthorizationSource(func() (string, []byte, error) {
		return relay.ReadDeviceAuthorization(relayConfig(cfg))
	}, s.executions)
	s.identities.WithGrantRevoker(revokeGrant(func(id string) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.RevokeGrant(ctx, id); err != nil {
			logger.WarnContext(ctx, "通知 Relay 撤销授权失败", "grant_id", id, "error", err)
		}
	}, s.keys))
	return client, extension.Runtime{ServerID: s.identities.DeviceServerID, Authorizer: s.identities, Readiness: client, Disconnect: func(user, machine string) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.Disconnect(ctx, user, machine); err != nil {
			logger.WarnContext(ctx, "通知 Relay 关闭云环境连接失败", "machine_id", machine, "error", err)
		}
	}}
}
