package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	_ "net/http/pprof"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/extension"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/feedback"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	agnesimage "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/agnes"
	openaiimages "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/openai/images"
	openairesponses "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/openai/responses"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/volcengine"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/xai"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rule"
	sessionreporting "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videoproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	role            config.Role
	servers         []*http.Server
	database        *pgxpool.Pool
	shutdownTimeout time.Duration
	billing         *billing.Service
	sessions        *sessionreporting.Service
	proxy           *proxy.Proxy
	images          *imagegen.Service
	videos          *videogen.Service
	inputs          *imagegen.Inputs
	runtimeKeys     *apikey.Service
	relay           *relay.Service
	relayStateDir   string
	relayClient     *relay.Control
	endpoints       *endpoint.Service
	feedback        *feedback.Service
	connectors      *mcp.Service
	knowledgeBases  *kb.Service
	resourceImports *resourceimport.Service
	modules         []extension.Module
}

type MemberWriters func(*pgxpool.Pool) (member.UserWriter, member.GroupWriter, error)

type AdminRegistrar interface {
	RegisterAdmin(chi.Router)
}

// PublicLicenseReader is an optional host extension for public branding.
type PublicLicenseReader = identity.PublicLicenseReader

// InstanceIdentity 由宿主扩展提供部署身份，在成员工厂完成后读取一次。
type InstanceIdentity interface {
	InstanceID(context.Context) (string, error)
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	return newApp(ctx, cfg, logger, func(*pgxpool.Pool) (member.UserWriter, member.GroupWriter, error) {
		return member.EmptyUserWriter{}, member.EmptyGroupWriter{}, nil
	}, nil)
}

func NewWithMembers(ctx context.Context, cfg config.Config, logger *slog.Logger, factory MemberWriters, registrars ...AdminRegistrar) (*App, error) {
	if factory == nil {
		return nil, errors.New("成员写入实现不可为空")
	}
	return newApp(ctx, cfg, logger, factory, registrars)
}

func newApp(ctx context.Context, cfg config.Config, logger *slog.Logger, factory MemberWriters, registrars []AdminRegistrar) (*App, error) {
	pool, err := database.Open(ctx, cfg.URL)
	if err != nil {
		return nil, err
	}
	var users member.UserWriter
	var groups member.GroupWriter
	if factory != nil {
		users, groups, err = factory(pool)
		if err != nil {
			pool.Close()
			return nil, err
		}
		if users == nil || groups == nil {
			pool.Close()
			return nil, errors.New("成员写入实现不可为空")
		}
	}
	handler, err := newApplicationHandlerWithMembers(ctx, logger, pool, cfg, users, groups, registrars)
	if err != nil {
		pool.Close()
		return nil, err
	}

	return &App{
		role: cfg.Role,
		servers: []*http.Server{
			{
				Addr:              cfg.Addr,
				Handler:           planeHandler(cfg.Role, handler),
				ReadHeaderTimeout: 5 * time.Second,
				IdleTimeout:       2 * time.Minute,
				MaxHeaderBytes:    1 << 20,
				ErrorLog:          logging.ErrorLog(logger),
			},
			{
				Addr:              cfg.PprofAddr,
				Handler:           debugHandler(handler.(*applicationHandler).relay),
				ReadHeaderTimeout: 5 * time.Second,
				IdleTimeout:       2 * time.Minute,
				MaxHeaderBytes:    1 << 20,
				ErrorLog:          logging.ErrorLog(logger),
			},
		},
		billing:         handler.(*applicationHandler).billing,
		sessions:        handler.(*applicationHandler).sessions,
		proxy:           handler.(*applicationHandler).proxy,
		images:          handler.(*applicationHandler).images,
		videos:          handler.(*applicationHandler).videos,
		inputs:          handler.(*applicationHandler).inputs,
		runtimeKeys:     handler.(*applicationHandler).runtimeKeys,
		relay:           handler.(*applicationHandler).relay,
		relayStateDir:   cfg.RuntimeStateDir,
		relayClient:     handler.(*applicationHandler).relayClient,
		endpoints:       handler.(*applicationHandler).endpoints,
		feedback:        handler.(*applicationHandler).feedback,
		connectors:      handler.(*applicationHandler).connectors,
		knowledgeBases:  handler.(*applicationHandler).knowledgeBases,
		resourceImports: handler.(*applicationHandler).resourceImports,
		modules:         handler.(*applicationHandler).modules,
		database:        pool,
		shutdownTimeout: cfg.ShutdownTimeout,
	}, nil
}

func debugHandler(runtime *relay.Service) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", http.DefaultServeMux)
	if runtime != nil {
		mux.HandleFunc("GET /debug/relay", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			if err := json.NewEncoder(w).Encode(runtime.Metrics()); err != nil {
				slog.Error("写入输出失败", "module", "app", "operation", "debugHandler", "error", err)
			}
		})
	}
	return mux
}

func newHandler(logger *slog.Logger, database httpapi.Pinger) http.Handler {
	admin := chi.NewRouter()
	agent := chi.NewRouter()
	auth := chi.NewRouter()
	router := chi.NewRouter()
	router.Use(web.New(logger).Middleware)
	router.NotFound(web.NotFound)
	router.MethodNotAllowed(web.MethodNotAllowed)
	proxy.NewProxy(nil, logger).Register(router)
	imageproxy.NewProxy(nil, nil, nil, nil, nil).Register(router)
	videoproxy.New(nil, nil, nil, nil).Register(router)
	router.Mount("/", httpapi.New(logger, database, admin, agent, auth))
	return router
}

func newApplicationHandler(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, cfg config.Config) (http.Handler, error) {
	return newApplicationHandlerWithMembers(ctx, logger, pool, cfg, nil, nil, nil)
}

func newApplicationHandlerWithMembers(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, cfg config.Config, users member.UserWriter, groups member.GroupWriter, registrars []AdminRegistrar) (http.Handler, error) {
	capabilities := licenseReader(registrars)
	settings := setting.NewService(setting.NewPostgres(pool))
	sessions := sessionreporting.NewService(pool).WithReportingSettings(settings).WithPurgeAuthorizer(func(ctx context.Context) bool {
		user, ok := identity.UserFromContext(ctx)
		return ok && user.Role == "admin"
	})
	identities := identity.NewService(pool, settings, cfg.PublicURL).WithEmailSender(settings).WithLicense(capabilities)
	executions := endpoint.NewExecution(pool, identities)
	sessions.WithHostAuthorizer(executions)
	identities.WithUserWriter(users)
	configurePublicLicense(identities, registrars)
	if cfg.Role != config.RoleProxy {
		if err := identities.EnsureInitialAdmin(ctx, cfg.InitialAdminName, cfg.InitialAdminEmail, cfg.InitialAdminPassword); err != nil && !errors.Is(err, member.ErrWriterUnavailable) {
			return nil, fmt.Errorf("初始化管理员: %w", err)
		}
	}
	charges := billing.NewService(pool)
	if err := charges.Initialize(ctx); err != nil {
		return nil, fmt.Errorf("初始化计费: %w", err)
	}
	identities.WithAccountPreserver(charges)
	keys := apikey.NewService(apikey.NewPostgres(pool))
	modelRepo := model.NewPostgres(pool)
	if cfg.Role != config.RoleProxy {
		charges.WithUsageReconciler(modelUsageReconciler{models: modelRepo, proxies: settings, responses: proxy.NewResponseReconciler()})
	}
	models := model.NewService(modelRepo).WithProxyResolver(settings).WithKeyAuthenticator(keys).WithGatewayURL(strings.TrimRight(cfg.PublicURL, "/") + "/v1")
	storage, err := resource.NewS3(ctx)
	if err != nil {
		return nil, err
	}
	initCtx, cancel := context.WithTimeout(ctx, time.Minute)
	err = storage.Init(initCtx)
	cancel()
	if err != nil {
		return nil, fmt.Errorf("初始化资源 Bucket: %w", err)
	}
	store := resource.NewStore(pool)
	connectors := mcp.NewService(store, cfg.PublicURL).WithStorage(storage).WithProxyResolver(settings).WithNetworkSettings(settings)
	knowledgeBases := kb.NewService(store, models).WithStorage(storage)
	execution := executionServices{pool: pool, settings: settings, sessions: sessions, identities: identities, executions: executions, keys: keys, charges: charges, modelRepo: modelRepo, models: models, storage: storage, connectors: connectors, knowledgeBases: knowledgeBases}
	if cfg.Role == config.RoleProxy {
		return execution.proxyHandler(ctx, cfg, logger, registrars)
	}
	identities.WithProfileStorage(storage)
	feedbacks := feedback.NewService(pool, storage)
	imageRepo := imagegen.NewPostgres(pool)
	imageInputs := imagegen.NewInputs(imageRepo, storage)
	imageOutputs := imagegen.NewOutputs(imageRepo, storage)
	imageService := imagegen.NewService(modelRepo, imageRepo, imageInputs, imageOutputs, charges).WithProxyResolver(settings)
	upstreamClient := &http.Client{Timeout: 10 * time.Minute, Transport: proxy.DirectTransport()}
	gptImages := openaiimages.New(upstreamClient)
	gptResponses := openairesponses.New(upstreamClient)
	seedream := volcengine.New(upstreamClient)
	agnesImages := agnesimage.New(upstreamClient)
	grok := xai.New(upstreamClient)
	imageService.WithAdapter(model.ProviderOpenAIImages, imagegen.Adapter{Capabilities: gptImages.Capabilities, DefaultCapabilities: gptImages.DefaultCapabilities, Generator: gptImages, Editor: gptImages})
	imageService.WithAdapter(model.ProviderOpenAIResponses, imagegen.Adapter{Capabilities: gptResponses.Capabilities, DefaultCapabilities: gptResponses.DefaultCapabilities, Generator: gptResponses, Editor: gptResponses})
	imageService.WithAdapter(model.ProviderVolcengine, imagegen.Adapter{Capabilities: seedream.Capabilities, DefaultCapabilities: seedream.DefaultCapabilities, Generator: seedream, Editor: seedream})
	imageService.WithAdapter(model.ProviderAgnes, imagegen.Adapter{Capabilities: agnesImages.Capabilities, DefaultCapabilities: agnesImages.DefaultCapabilities, Generator: agnesImages, Editor: agnesImages})
	imageService.WithAdapter(model.ProviderXAI, imagegen.Adapter{Capabilities: grok.Capabilities, DefaultCapabilities: grok.DefaultCapabilities, Generator: grok, Editor: grok})
	models.WithImageCapabilities(imageService.Capabilities)
	videoService := videogen.NewService(pool, storage, charges, modelRepo).WithProxyResolver(settings)
	rules := rule.NewService(store)
	skills := skill.NewService(store, storage)
	experts := expert.NewService(store).WithStorage(storage)

	models.WithEmbeddingChangeHook(knowledgeBases.SyncEmbeddingModels)
	resources := agentconfig.NewResources(store, connectors, skills)

	admin := chi.NewRouter()
	admin.Use(identities.RequireAdmin)
	admin.Use(rootgroup.Middleware(settings))
	audits := audit.NewService(pool, logger)
	admin.Use(audits.Middleware(func(r *http.Request) audit.Actor {
		user, _ := identity.UserFromContext(r.Context())
		return audit.Actor{ID: user.ID, Name: user.Name, Email: user.Email}
	}))
	audits.RegisterAdmin(admin)
	identities.RegisterAdmin(admin)
	engineHosts := enginehost.NewService(pool).WithInstallation(cfg.PublicURL, cfg.EngineReleaseDir, cfg.EngineVersion).WithLicense(capabilities)
	if cfg.EngineReleaseDir != "" {
		stateDir := cfg.RuntimeStateDir
		if stateDir == "" {
			stateDir = "data/runtime"
		}
		key, err := enginehost.EnrollmentKey(filepath.Join(stateDir, "host-signing.key"))
		if err != nil {
			return nil, fmt.Errorf("初始化宿主接入签名: %w", err)
		}
		engineHosts.WithEnrollmentKey(key)
	}
	engineHosts.RegisterAdmin(admin)
	groupService := group.NewService(pool).WithAccountPreserver(charges).WithMemberWriter(groups)
	groupService.RegisterAdmin(admin)
	settings.RegisterAdmin(admin)
	charges.RegisterAdmin(admin)
	stats.NewService(pool).RegisterAdmin(admin)
	keys.RegisterAdmin(admin)
	models.RegisterAdmin(admin)
	store.RegisterAdmin(admin)
	store.RegisterGrants(admin, map[string]*resource.CRUD{"rule": rules, "skill": skills.CRUD, "expert": experts.CRUD, "connector": connectors.Connectors, "kb": knowledgeBases.CRUD})
	resourceImports := resourceimport.NewService(pool, storage)
	resourceImports.RegisterAdmin(admin)
	rules.Register(admin)
	skills.RegisterAdmin(admin)
	connectors.RegisterAdmin(admin)
	experts.RegisterAdmin(admin)
	knowledgeBases.RegisterAdmin(admin)
	resources.RegisterAdmin(admin)
	feedbacks.RegisterAdmin(admin)
	sessions.RegisterAdmin(admin)

	agent := chi.NewRouter()
	agent.Use(identities.RequireAgent)
	agent.Use(rootgroup.Middleware(settings))
	interactive := agent.With(identity.RequireInteractive)
	account := agent.With(identity.RequireAccountResources)
	endpointStore := endpoint.NewPostgres(pool).WithDeviceAuthorizer(identities)
	var instanceID string
	var lookupInstance func(context.Context) (string, error)
	for _, registrar := range registrars {
		if source, ok := registrar.(InstanceIdentity); ok {
			lookupInstance = source.InstanceID
			instanceID, err = source.InstanceID(ctx)
			if err != nil {
				logger.WarnContext(ctx, "读取部署实例身份失败，设计资源签发不可用", "error", err)
				instanceID = ""
			}
			break
		}
	}
	designs := designcatalog.NewService(pool, storage).WithAccess(designcatalog.AccessConfig{PublicURL: cfg.PublicURL, InstanceID: instanceID, LookupInstance: lookupInstance, PublisherID: cfg.DesignPublisherID, RespubURL: cfg.DesignRespubURL, RespubSecret: cfg.DesignRespubJWTSecret, MediaSecret: cfg.DesignMediaJWTSecret}).WithDevices(designDevices{endpointStore})
	resourceImports.WithDesignCatalog(designs).WithKnowledgeCatalog(knowledgeBases)
	endpoints := endpoint.NewService(endpointStore, endpointAuth{identities}, logger, cfg.PublicURL).WithMaxConnections(cfg.EndpointMaxConnections)
	if cfg.Role != config.RoleControl {
		endpoints.RegisterAgent(agent)
	}
	endpoints.RegisterAdmin(admin)
	identities.RegisterAgent(agent)
	group.NewService(pool).RegisterAgent(interactive)
	if cfg.Role != config.RoleControl {
		keys.RegisterAgent(agent.With(identity.RequireGatewayKeys))
	}
	models.RegisterAgent(account)
	rules.RegisterAgent(account)
	skills.RegisterAgent(account)
	experts.RegisterAgent(account)
	knowledgeBases.RegisterAgent(account)
	store.RegisterSharing(account, map[string]resource.Shareable{"model": modelRepo, "rule": rules, "skill": skills.CRUD, "connector": connectors.Connectors, "expert": experts.CRUD, "kb": knowledgeBases.CRUD})
	settings.RegisterAgent(agent)
	connectors.RegisterAgent(account)
	resources.RegisterAgent(account)
	charges.RegisterAgent(interactive)
	feedbacks.RegisterAgent(interactive)
	sessions.RegisterIndex(agent)
	if cfg.Role != config.RoleControl {
		sessions.RegisterReporting(agent)
	}

	router := chi.NewRouter()

	router.Use(web.New(logger).Middleware)
	router.Use(relay.PreviewGuard(cfg.RuntimePreviewOriginTemplate))
	requireResource := func(next http.Handler) http.Handler {
		return identities.RequireAgent(identity.RequireAccountResources(next))
	}
	router.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "" {
				requireResource(next).ServeHTTP(w, r)
			} else {
				identities.RequireBrowser(next).ServeHTTP(w, r)
			}
		})
	}).Get("/api/kb/{id}/assets/{name}", knowledgeBases.ServeAsset)
	router.NotFound(web.NotFound)
	router.MethodNotAllowed(web.MethodNotAllowed)
	designs.RegisterCatalog(router, requireResource)
	sessionResolver := sessionAdapter{service: sessions}
	var modelProxy *proxy.Proxy
	if cfg.Role != config.RoleControl {
		modelProxy = execution.registerGateway(router, logger)
	}
	imageproxy.NewProxy(modelResolver{service: models}, keys, imageService, imageService, imageService).
		WithSessionResolver(sessionResolver).
		WithInputs(imageUploader{inputs: imageInputs}).WithOutputs(imageOutputs).Register(router)
	videoproxy.New(modelResolver{service: models}, keys, sessionResolver, videoService).Register(router)
	var runtimeRelay *relay.Service
	var relayClient *relay.Control
	var runtimeServices extension.Runtime
	if cfg.RuntimeRelay {
		if cfg.Role == config.RoleControl {
			relayClient, runtimeServices = execution.remoteRuntime(cfg, logger)
		} else {
			runtimeRelay, err = execution.attachRelay(cfg, logger, router, endpoints, endpointStore)
			if err != nil {
				return nil, err
			}
			runtimeServices = extension.Runtime{ServerID: identities.DeviceServerID, Authorizer: identities, Readiness: runtimeRelay, Disconnect: runtimeRelay.DisconnectRuntime}
		}
	}
	router.Get("/oauth/connectors/{id}/callback", connectors.Callback)
	if cfg.Role != config.RoleControl {
		registerOAuth(router, identities)
	}
	services := extension.Services{
		Pool: pool, Storage: storage, Credits: charges, PublicURL: cfg.PublicURL,
		ImageStateDir: cfg.ImageStateDir, ImageImportDir: cfg.ImageImportDir,
		RuntimeReleaseDir: cfg.RuntimeReleaseDir, RuntimeVersion: cfg.RuntimeVersion,
		RegistryAuthorized: engineHosts.RegistryAuthorized,
		Runtime:            runtimeServices,
	}
	modules, bindings, err := initializeModules(ctx, registrars, services)
	if err != nil {
		return nil, fmt.Errorf("初始化宿主扩展: %w", err)
	}
	for _, binding := range bindings {
		if binding.Branding != nil {
			settings.WithBranding(binding.Branding)
			identities.WithBranding(binding.Branding)
		}
		if binding.RuntimeAccess != nil {
			identities.WithRuntimeAccess(binding.RuntimeAccess)
		}
		if binding.Pricing != nil {
			charges.WithPricing(binding.Pricing)
		}
		if binding.HostCounts != nil {
			engineHosts.WithHostCounts(binding.HostCounts)
		}
		if binding.DeviceNames != nil {
			endpointStore.WithNames(binding.DeviceNames)
			executions.WithNames(binding.DeviceNames)
		}
		if binding.Commands != nil {
			engineHosts.WithCommands(binding.Commands)
		}
	}
	engineHosts.Register(router)
	authRouter := identities.AuthRouter()
	for _, registrar := range registrars {
		if registrar != nil {
			registrar.RegisterAdmin(admin)
		}
	}
	for _, module := range modules {
		module.RegisterAgent(interactive)
		module.RegisterPublic(router)
		module.RegisterAuth(authRouter)
	}
	auth := audits.Middleware(func(r *http.Request) audit.Actor {
		switch r.URL.Path {
		case "/api/auth/v1/admin/login", "/api/auth/v1/admin/email/login":
			return audit.Actor{Name: "未认证用户"}
		case "/api/auth/v1/logout":
			if user, ok := identities.BrowserUser(r); ok {
				return audit.Actor{ID: user.ID, Name: user.Name, Email: user.Email}
			}
			return audit.Actor{Name: "未认证用户"}
		default:
			return audit.Actor{}
		}
	})(authRouter)
	router.Mount("/", httpapi.New(logger, readiness{pool: pool, storage: storage, endpoints: endpoints}, admin, agent, auth))
	return &applicationHandler{modules: modules, Handler: router, sessions: sessions, billing: charges, proxy: modelProxy, images: imageService, videos: videoService, inputs: imageInputs, endpoints: endpoints, relay: runtimeRelay, relayClient: relayClient, runtimeKeys: keys, feedback: feedbacks, connectors: connectors, knowledgeBases: knowledgeBases, resourceImports: resourceImports}, nil
}

type sessionAdapter struct{ service *sessionreporting.Service }

func (a sessionAdapter) EnsureSession(ctx context.Context, userID, sessionID, parentID, groupID string) error {
	return a.service.EnsureSession(ctx, userID, sessionID, parentID, groupID)
}

type modelResolver struct {
	service *model.Service
}

func (r modelResolver) Resolve(ctx context.Context, credential, requestedModel string) (proxy.Target, error) {
	target, err := r.service.Resolve(ctx, credential, requestedModel)
	if err != nil {
		return proxy.Target{}, err
	}
	return proxy.Target{
		ModelID:       target.ID,
		OwnershipType: target.OwnershipType,
		UpstreamModel: target.UpstreamModelID,
		Protocol:      string(target.Protocol),
		UserID:        target.UserID,
		BaseURL:       target.BaseURL,
		ProxyURL:      target.ProxyURL,
		APIKey:        target.APIKey,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	defer a.database.Close()
	defer logModuleClose(a.modules)
	if a.relayClient != nil {
		defer a.relayClient.Close()
	}
	var controlServer *http.Server
	var controlListener net.Listener
	if a.role == config.RoleProxy && a.relay != nil {
		var err error
		controlListener, err = relay.ListenControl(a.relayStateDir)
		if err != nil {
			return fmt.Errorf("监听 Relay 内部套接字: %w", err)
		}
		controlServer = &http.Server{Handler: a.relay.ControlHandler(revokeGrant(a.relay, a.runtimeKeys)), ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second}
		a.servers = append(a.servers, controlServer)
	}
	workerCtx, stopWorker := context.WithCancel(context.Background())
	var workers sync.WaitGroup
	start := func(run func(context.Context)) { workers.Go(func() { run(workerCtx) }) }
	if a.role != config.RoleControl {
		start(a.sessions.Run)
		start(a.endpoints.Observe)
		start(a.connectors.RunCredentials)
		if a.relay != nil {
			start(a.relay.Run)
			start(a.cleanupRuntimeKeys)
		}
	}
	if a.role != config.RoleProxy {
		start(a.billing.Run)
		start(a.images.Run)
		start(a.videos.Run)
		start(a.connectors.RunToolRefresh)
		start(func(ctx context.Context) { runImageCleanup(ctx, a.inputs) })
		start(a.knowledgeBases.Run)
		start(a.resourceImports.Run)
		start(func(ctx context.Context) {
			if err := a.feedback.Run(ctx, time.Hour); err != nil {
				slog.Error("清理反馈失败", "error", err)
			}
		})
	}
	modulesDone := runModules(workerCtx, a.modules)
	defer func() { stopWorker(); workers.Wait(); <-modulesDone }()

	result := make(chan error, len(a.servers))
	for _, server := range a.servers {
		go func() {
			var err error
			if server == controlServer {
				err = server.Serve(controlListener)
			} else {
				err = server.ListenAndServe()
			}
			if errors.Is(err, http.ErrServerClosed) {
				err = nil
			} else if err != nil {
				err = fmt.Errorf("监听 %s: %w", server.Addr, err)
			}
			result <- err
		}()
	}

	completed := 0
	var runErrors []error
	select {
	case err := <-result:
		runErrors = append(runErrors, err)
		completed++
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.shutdownTimeout)
	defer cancel()
	bridgeCtx, bridgeCancel := context.WithTimeout(shutdownCtx, 10*time.Second)
	if a.relay != nil {
		if err := a.relay.Shutdown(bridgeCtx); err != nil {
			runErrors = append(runErrors, fmt.Errorf("关闭远程执行中转: %w", err))
		}
	}
	if err := a.endpoints.Shutdown(bridgeCtx); err != nil {
		runErrors = append(runErrors, fmt.Errorf("关闭端点桥接: %w", err))
	}
	bridgeCancel()
	for _, server := range a.servers {
		if err := server.Shutdown(shutdownCtx); err != nil {
			runErrors = append(runErrors, fmt.Errorf("关闭 %s: %w", server.Addr, err))
		}
	}

	if a.proxy != nil {
		if err := a.proxy.Wait(shutdownCtx); err != nil {
			runErrors = append(runErrors, err)
		}
	}
	if a.images != nil {
		if err := a.images.Wait(shutdownCtx); err != nil {
			runErrors = append(runErrors, err)
		}
	}
	if a.videos != nil {
		if err := a.videos.Wait(shutdownCtx); err != nil {
			runErrors = append(runErrors, err)
		}
	}
	for completed < len(a.servers) {
		runErrors = append(runErrors, <-result)
		completed++
	}
	return errors.Join(runErrors...)
}

func (a *App) cleanupRuntimeKeys(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			scan, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := a.runtimeKeys.CleanupRuntimeKeys(scan)
			cancel()
			if err != nil && ctx.Err() == nil {
				logging.Event(ctx, slog.Default(), slog.LevelWarn, "worker.scan.failed", "回收独立执行密钥标记失败", "module", "app", "error", err)
			}
		}
	}
}

type readiness struct {
	pool      *pgxpool.Pool
	storage   resource.Storage
	endpoints *endpoint.Service
}

func (r readiness) Ping(ctx context.Context) error {
	if r.endpoints != nil && !r.endpoints.Ready() {
		return logging.Dependency("endpoint", errors.New("端点桥接正在停止"))
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.pool.Ping(ctx); err != nil {
		return logging.Dependency("database", err)
	}
	return logging.Dependency("object_storage", r.storage.Ping(ctx))
}
