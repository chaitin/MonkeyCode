package proxy

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
	"github.com/chaitin/MonkeyCode/backend/pkg/tee"
)

type CtxKey struct{}

type ProxyCtx struct {
	ctx        context.Context
	Path       string
	Model      *domain.Model
	Header     http.Header
	RespHeader http.Header
	ReqTee     *tee.ReqTee
	RequestID  string
	UserID     string
}

type LLMProxy struct {
	logger    *slog.Logger
	cfg       *config.Config
	usecase   domain.ProxyUsecase
	transport *http.Transport
	proxy     *httputil.ReverseProxy
}

func NewLLMProxy(
	logger *slog.Logger,
	cfg *config.Config,
	usecase domain.ProxyUsecase,
) *LLMProxy {
	l := &LLMProxy{
		logger:  logger,
		cfg:     cfg,
		usecase: usecase,
	}

	l.transport = &http.Transport{
		MaxIdleConns:        cfg.LLMProxy.ClientPoolSize,
		MaxConnsPerHost:     cfg.LLMProxy.ClientPoolSize,
		MaxIdleConnsPerHost: cfg.LLMProxy.ClientPoolSize,
		IdleConnTimeout:     24 * time.Hour,
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 24 * time.Hour,
		}).DialContext,
	}
	l.proxy = &httputil.ReverseProxy{
		Transport:      l.transport,
		Rewrite:        l.rewrite,
		ModifyResponse: l.modifyResponse,
		ErrorHandler:   l.errorHandler,
		FlushInterval:  100 * time.Millisecond,
	}
	return l
}

func (l *LLMProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	l.proxy.ServeHTTP(w, r)
}

func (l *LLMProxy) Close() error {
	l.transport.CloseIdleConnections()
	return nil
}

var modelType = map[string]consts.ModelType{
	"/v1/chat/completions": consts.ModelTypeLLM,
	"/v1/completions":      consts.ModelTypeCoder,
}

func (l *LLMProxy) rewrite(r *httputil.ProxyRequest) {
	l.logger.DebugContext(r.In.Context(), "rewrite request", slog.String("path", r.In.URL.Path))
	mt, ok := modelType[r.In.URL.Path]
	if !ok {
		l.logger.ErrorContext(r.In.Context(), "model type not found", slog.String("path", r.In.URL.Path))
		return
	}

	m, err := l.usecase.SelectModelWithLoadBalancing("", mt)
	if err != nil {
		l.logger.ErrorContext(r.In.Context(), "select model with load balancing failed", slog.String("path", r.In.URL.Path), slog.Any("err", err))
		return
	}
	ul, err := url.Parse(m.APIBase)
	if err != nil {
		l.logger.ErrorContext(r.In.Context(), "parse model api base failed", slog.String("path", r.In.URL.Path), slog.Any("err", err))
		return
	}

	path := r.In.URL.Path
	path = strings.ReplaceAll(path, "/v1", "")
	path = ul.Path + path
	if r.In.ContentLength > 0 {
		tee := tee.NewReqTeeWithMaxSize(r.In.Body, 10*1024*1024)
		r.Out.Body = tee
		ctx := context.WithValue(r.In.Context(), CtxKey{}, &ProxyCtx{
			ctx:       r.In.Context(),
			Path:      path,
			Model:     m,
			ReqTee:    tee,
			RequestID: r.In.Context().Value(logger.RequestIDKey{}).(string),
			UserID:    r.In.Context().Value(logger.UserIDKey{}).(string),
			Header:    r.In.Header,
		})
		r.Out = r.Out.WithContext(ctx)
	}

	u, err := url.Parse(m.APIBase)
	if err != nil {
		l.logger.ErrorContext(r.In.Context(), "parse model api base failed", slog.String("path", r.In.URL.Path), slog.Any("err", err))
		return
	}

	r.Out.URL.Scheme = u.Scheme
	r.Out.URL.Host = u.Host
	r.Out.URL.Path = path
	r.Out.Header.Set("Authorization", "Bearer "+m.APIKey)
	r.SetXForwarded()
	r.Out.Host = u.Host
	l.logger.With("in", r.In.URL.Path, "out", r.Out.URL.Path).DebugContext(r.In.Context(), "rewrite request")
}

func (l *LLMProxy) modifyResponse(resp *http.Response) error {
	if resp.StatusCode != http.StatusOK {
		resp.Body = NewRespLog(resp.Request.Context(), l.logger, resp.Body)
		return nil
	}

	ctx := resp.Request.Context()
	if pctx, ok := ctx.Value(CtxKey{}).(*ProxyCtx); ok {
		pctx.ctx = ctx
		pctx.RespHeader = resp.Header
		resp.Body = NewRecorder(l.cfg, pctx, resp.Body, l.logger, l.usecase)
	}
	return nil
}

func (l *LLMProxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	l.logger.ErrorContext(r.Context(), "error handler", slog.String("path", r.URL.Path), slog.Any("err", err))
}
