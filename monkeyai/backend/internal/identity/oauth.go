package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) OAuthRouter() http.Handler {
	router := chi.NewRouter()
	router.Get("/authorize", s.authorize)
	router.Post("/device/authorization", s.deviceAuthorization)
	router.Post("/token", s.token)
	router.Post("/revoke", s.revoke)
	return router
}

func (s *Service) AuthRouter() http.Handler {
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
		})
	})
	router.Get("/branding", s.branding)
	router.Get("/clients", s.clients)
	router.Get("/providers", s.providers)
	router.Post("/admin/login", s.passwordLogin)
	router.Get("/methods", s.methods)
	router.Post("/login", s.passwordLogin)
	router.Post("/email/code", s.sendCode)
	router.Post("/email/login", s.emailLogin)
	router.Post("/admin/email/login", s.emailLogin)
	router.Post("/email/reset-password", s.resetPassword)
	router.Get("/session", s.session)
	router.Post("/logout", s.logout)
	router.With(s.RequireBrowser).Post("/device/decision", s.deviceDecision)
	router.Get("/client-requests/{requestID}", s.clientRequest)
	router.With(s.RequireBrowser).Post("/client-requests/{requestID}/complete", s.completeClientRequest)
	router.Get("/oauth/{connectionID}/start", s.startUpstream)
	router.Get("/oauth/{connectionID}/admin-start", s.startAdminUpstream)
	router.Get("/oauth/callback", s.upstreamCallback)
	return router
}

func (s *Service) OAuthMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	scopes := make([]string, 0, len(scopeNames))
	for scope := range scopeNames {
		scopes = append(scopes, scope)
	}
	slices.Sort(scopes)
	metadata := map[string]any{
		"issuer":                                s.publicURL,
		"authorization_endpoint":                s.publicURL + "/oauth/authorize",
		"token_endpoint":                        s.publicURL + "/oauth/token",
		"revocation_endpoint":                   s.publicURL + "/oauth/revoke",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      scopes,
	}
	if s.deviceEnabled() {
		metadata["device_authorization_endpoint"] = s.publicURL + "/oauth/device/authorization"
		metadata["grant_types_supported"] = []string{"authorization_code", "refresh_token", DeviceGrantType}
	}
	if s.runtimeMetadata != nil {
		runtime := make(map[string]any, len(s.runtimeMetadata))
		for key, value := range s.runtimeMetadata {
			runtime[key] = value
		}
		if s.runtimeFeatures != nil {
			features := map[string]bool{}
			if existing, ok := runtime["features"].(map[string]bool); ok {
				for key, value := range existing {
					features[key] = value
				}
			}
			current, err := s.runtimeFeatures(r.Context())
			if err != nil {
				slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "OAuthMetadata", "error", err)
				writeError(r.Context(), w, 503, "capabilities_unavailable", "功能策略暂不可用")
				return
			}
			for key, value := range current {
				features[key] = value
			}
			runtime["features"] = features
		}
		metadata["monkeyai_runtime"] = runtime
	}
	writeJSON(r.Context(), w, http.StatusOK, metadata)
}

func (s *Service) clients(w http.ResponseWriter, r *http.Request) {
	clients := []Client{Clients["monkeyai-desktop"], Clients["monkeyai-mobile"]}
	if s.deviceEnabled() {
		clients = append(clients, Clients[RuntimeClientID])
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]any{"clients": clients})
}

func (s *Service) authorize(w http.ResponseWriter, r *http.Request) {
	request, err := s.BeginAuthorization(r.Context(), r.URL.Query())
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	http.Redirect(w, r, s.clientLoginURL(request.ID, ""), http.StatusFound)
}

func (s *Service) token(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "token", "error", err)
		s.writeOAuthError(r.Context(), w, oauthError("invalid_request", "请求格式无效"))
		return
	}
	var token Token
	var err error
	switch r.PostForm.Get("grant_type") {
	case "authorization_code":
		token, err = s.ExchangeCode(r.Context(), r.PostForm.Get("client_id"), r.PostForm.Get("redirect_uri"), r.PostForm.Get("code"), r.PostForm.Get("code_verifier"))
	case DeviceGrantType:
		if !s.deviceLimit(r, "poll", 300) {
			w.Header().Set("Retry-After", "60")
			s.writeOAuthError(r.Context(), w, oauthError("slow_down", "设备轮询过于频繁"))
			return
		}
		token, err = s.ExchangeDeviceCode(r.Context(), r.PostForm.Get("client_id"), r.PostForm.Get("device_code"))
	case "refresh_token":
		token, err = s.Refresh(r.Context(), r.PostForm.Get("client_id"), r.PostForm.Get("refresh_token"))
	default:
		err = oauthError("unsupported_grant_type", "不支持的 grant_type")
	}
	if err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(r.Context(), w, http.StatusOK, token)
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "revoke", "error", err)
		s.writeOAuthError(r.Context(), w, oauthError("invalid_request", "请求格式无效"))
		return
	}
	if err := s.revokeToken(r.Context(), tokenHash(r.PostForm.Get("token")), r.PostForm.Get("client_id")); err != nil {
		s.writeOAuthError(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

func (s *Service) writeOAuthError(ctx context.Context, w http.ResponseWriter, err error) {
	var protocol protocolError
	status := http.StatusBadRequest
	if !errors.As(err, &protocol) {
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "OAuth 请求处理失败", "module", "identity", "operation", "writeOAuthError", "error", err)
		protocol = protocolError{Code: "server_error", Description: "服务暂时不可用"}
		status = http.StatusServiceUnavailable
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(ctx, w, status, protocol)
}

func (s *Service) providers(w http.ResponseWriter, r *http.Request) {
	connections, err := s.connections(r.Context())
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取登录方式失败", "module", "identity", "operation", "providers", "error", err)
		writeError(r.Context(), w, http.StatusServiceUnavailable, "settings_unavailable", "认证配置不可用")
		return
	}
	type provider struct {
		ID       string `json:"id"`
		Provider string `json:"provider"`
		Name     string `json:"name"`
	}
	result := make([]provider, 0, len(connections))
	for _, connection := range connections {
		result = append(result, provider{ID: connection.ID, Provider: connection.Provider, Name: connection.Name})
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]any{"providers": result})
}

func (s *Service) session(w http.ResponseWriter, r *http.Request) {
	user, ok := s.BrowserUser(r)
	writeJSON(r.Context(), w, http.StatusOK, map[string]any{"authenticated": ok, "user": nullableUser(user, ok)})
}

func nullableUser(user User, ok bool) any {
	if !ok {
		return nil
	}
	return user
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if err := s.revokeBrowserSession(r.Context(), tokenHash(cookie.Value)); err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "撤销浏览器会话失败", "module", "identity", "operation", "logout", "error", err)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) clientRequest(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("purpose") == "device" || chi.URLParam(r, "requestID") == "device" {
		s.deviceRequest(w, r)
		return
	}
	request, err := s.authorizationRequest(r.Context(), chi.URLParam(r, "requestID"))
	if err != nil || request.CompletedAt != nil || !s.now().Before(request.ExpiresAt) || !validClientRedirect(request.ClientID, request.RedirectURI) {
		if err != nil && !errors.Is(err, ErrNotFound) {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "查询客户端授权请求失败", "module", "identity", "operation", "clientRequest", "request_id", chi.URLParam(r, "requestID"), "error", err)
		}
		writeError(r.Context(), w, http.StatusNotFound, "request_not_found", "授权请求不存在、已完成或已过期")
		return
	}
	connections, err := s.connections(r.Context())
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取客户端授权登录方式失败", "module", "identity", "operation", "clientRequest", "request_id", request.ID, "error", err)
		writeError(r.Context(), w, http.StatusServiceUnavailable, "settings_unavailable", "认证配置不可用")
		return
	}
	user, authenticated := s.BrowserUser(r)
	client := Clients[request.ClientID]
	client.RedirectURI = request.RedirectURI
	scopes := request.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]any{
		"request_id":         request.ID,
		"client":             client,
		"authenticated":      authenticated,
		"user":               nullableUser(user, authenticated),
		"providers":          publicConnections(connections),
		"scopes":             scopes,
		"scope_descriptions": scopeNames,
		"audience":           request.Audience,
		"consent_required":   true,
		"csrf_token":         consentToken(r, request.ID),
	})
}

func publicConnections(connections []OAuthConnection) []map[string]string {
	result := make([]map[string]string, 0, len(connections))
	for _, connection := range connections {
		result = append(result, map[string]string{"id": connection.ID, "provider": connection.Provider, "name": connection.Name})
	}
	return result
}

func (s *Service) completeClientRequest(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	requestID := chi.URLParam(r, "requestID")
	request, err := s.authorizationRequest(r.Context(), requestID)
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "completeClientRequest", "error", err)
		writeError(r.Context(), w, http.StatusNotFound, "request_not_found", "授权请求不存在")
		return
	}
	approval, err := readApproval(w, r, request, s.publicURL)
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "consent_required", err.Error())
		return
	}
	launchURL, err := s.completeAuthorization(r.Context(), requestID, user.ID, approval)
	if err != nil {
		writeError(r.Context(), w, http.StatusConflict, "request_unavailable", err.Error())
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]string{"launch_url": launchURL})
}

func (s *Service) startUpstream(w http.ResponseWriter, r *http.Request) {
	requestID := r.URL.Query().Get("request_id")
	if requestID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "request_required", "缺少客户端授权请求")
		return
	}
	if r.URL.Query().Get("purpose") == "device" {
		if !s.deviceEnabled() || !deviceUUID(requestID) {
			writeError(r.Context(), w, 400, "request_unavailable", "设备申请无效")
			return
		}
		request, err := sqlc.New(s.db).DeviceRequestByID(r.Context(), requestID)
		if err != nil || request.Status != "pending" || !s.now().Before(request.ExpiresAt) {
			if err != nil {
				slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "startUpstream", "error", err)
			}
			writeError(r.Context(), w, 400, "request_unavailable", "设备申请已完成或过期")
			return
		}
		s.beginUpstream(w, r, requestID, loginPurposeDevice)
		return
	}
	request, err := s.authorizationRequest(r.Context(), requestID)
	if err != nil || request.CompletedAt != nil || !s.now().Before(request.ExpiresAt) || !validClientRedirect(request.ClientID, request.RedirectURI) {
		if err != nil && !errors.Is(err, ErrNotFound) {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "查询上游登录授权请求失败", "module", "identity", "operation", "startUpstream", "request_id", requestID, "error", err)
		}
		writeError(r.Context(), w, http.StatusBadRequest, "request_unavailable", "授权请求无效")
		return
	}
	s.beginUpstream(w, r, requestID, loginPurposeClient)
}

func (s *Service) startAdminUpstream(w http.ResponseWriter, r *http.Request) {
	s.beginUpstream(w, r, "", loginPurposeAdmin)
}

func (s *Service) beginUpstream(w http.ResponseWriter, r *http.Request, requestID, purpose string) {
	connectionID := chi.URLParam(r, "connectionID")
	connection, err := s.connection(r.Context(), connectionID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取上游连接失败", "module", "identity", "operation", "beginUpstream", "connection_id", connectionID, "error", err)
		}
		writeError(r.Context(), w, http.StatusNotFound, "provider_not_found", "登录方式不存在")
		return
	}
	state, err := randomToken(32)
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "准备上游登录失败", "module", "identity", "operation", "beginUpstream", "connection_id", connectionID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "无法发起登录")
		return
	}
	if err := s.createLoginState(r.Context(), tokenHash(state), connectionID, requestID, purpose, s.now().Add(s.requestTTL)); err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "创建上游登录状态失败", "module", "identity", "operation", "beginUpstream", "connection_id", connectionID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "无法发起登录")
		return
	}
	target, err := s.upstreamAuthorizeURL(r.Context(), connection, state)
	if err != nil {
		logUpstreamFailure(r.Context(), "构造上游授权地址", connectionID, err)
		writeError(r.Context(), w, http.StatusBadGateway, "provider_unavailable", "登录方式暂不可用")
		return
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (s *Service) upstreamCallback(w http.ResponseWriter, r *http.Request) {
	state, err := s.consumeLoginState(r.Context(), tokenHash(r.URL.Query().Get("state")))
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取上游登录状态失败", "module", "identity", "operation", "upstreamCallback", "error", err)
		}
		http.Redirect(w, r, s.clientLoginURL("", "oauth_callback"), http.StatusFound)
		return
	}
	if r.URL.Query().Get("code") == "" {
		http.Redirect(w, r, s.upstreamResultURL(state, "oauth_callback"), http.StatusFound)
		return
	}
	connection, err := s.connection(r.Context(), state.ConnectionID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取上游登录配置失败", "module", "identity", "operation", "upstreamCallback", "connection_id", state.ConnectionID, "error", err)
		}
		http.Redirect(w, r, s.upstreamResultURL(state, "provider_unavailable"), http.StatusFound)
		return
	}
	profile, err := s.exchangeUpstream(r.Context(), connection, r.URL.Query().Get("code"))
	if err != nil {
		logUpstreamFailure(r.Context(), "交换上游身份", state.ConnectionID, err)
		http.Redirect(w, r, s.upstreamResultURL(state, "oauth_exchange"), http.StatusFound)
		return
	}
	adminLogin := state.Purpose == loginPurposeAdmin
	user, err := s.upsertIdentity(r.Context(), profile, adminLogin, connection.autoRegistrationEnabled())
	if err != nil {
		code := "user_unavailable"
		switch {
		case errors.Is(err, ErrAdminRoleRequired), errors.Is(err, member.ErrAdminRoleRequired):
			code = "admin_role_required"
		case adminLogin && (errors.Is(err, ErrUserDisabled) || errors.Is(err, member.ErrUserDisabled)):
			code = "admin_role_required"
		case errors.Is(err, member.ErrSeatsExceeded):
			code = "seats_exceeded"
		case errors.Is(err, member.ErrSeatsUnavailable):
			code = "seats_unavailable"
		case errors.Is(err, member.ErrWriterUnavailable):
			code = "member_writer_unavailable"
		}
		http.Redirect(w, r, s.upstreamResultURL(state, code), http.StatusFound)
		return
	}
	token, err := randomToken(32)
	if err == nil {
		err = s.createBrowserSession(r.Context(), user.ID, tokenHash(token), "oauth", s.now().Add(s.sessionTTL))
	}
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "创建上游登录会话失败", "module", "identity", "operation", "upstreamCallback", "user_id", user.ID, "error", err)
		http.Redirect(w, r, s.upstreamResultURL(state, "session_failed"), http.StatusFound)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode, MaxAge: int(s.sessionTTL.Seconds())})
	http.Redirect(w, r, s.upstreamResultURL(state, ""), http.StatusFound)
}

func (s *Service) upstreamResultURL(state LoginState, errorCode string) string {
	if state.Purpose == loginPurposeDevice {
		query := url.Values{"request_id": {state.DeviceRequestID}}
		if errorCode != "" {
			query.Set("error", errorCode)
		}
		return s.publicURL + "/device?" + query.Encode()
	}
	if state.Purpose == loginPurposeAdmin {
		query := url.Values{}
		if errorCode != "" {
			query.Set("oauth_error", errorCode)
		}
		result := s.publicURL + "/login"
		if encoded := query.Encode(); encoded != "" {
			result += "?" + encoded
		}
		return result
	}
	return s.clientLoginURL(state.AuthorizationRequestID, errorCode)
}

func (s *Service) clientLoginURL(requestID, errorCode string) string {
	query := url.Values{}
	if requestID != "" {
		query.Set("request_id", requestID)
	}
	if errorCode != "" {
		query.Set("error", errorCode)
	}
	return s.publicURL + "/client-login?" + query.Encode()
}

func logUpstreamFailure(ctx context.Context, operation, connectionID string, err error) {
	if response, ok := errors.AsType[*upstreamHTTPError](err); ok {
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "上游 OAuth 操作失败", "module", "identity", "operation", "logUpstreamFailure", "operation", operation, "connection_id", connectionID, "reason", "http_status", "status", response.status, "error", err)
		return
	}
	reason := "invalid_upstream_response"
	var urlErr *url.Error
	switch {
	case errors.Is(err, context.Canceled):
		reason = "request_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		reason = "request_timeout"
	case errors.As(err, &urlErr):
		if urlErr.Op == "parse" {
			reason = "invalid_upstream_url"
		} else {
			reason = "request_failed"
		}
	}
	logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "上游 OAuth 操作失败", "module", "identity", "operation", "logUpstreamFailure", "operation", operation, "connection_id", connectionID, "reason", reason, "error", err)
}
