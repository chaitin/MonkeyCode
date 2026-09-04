package identity

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func (s *Service) OAuthRouter() http.Handler {
	router := chi.NewRouter()
	router.Get("/authorize", s.authorize)
	router.Post("/token", s.token)
	router.Post("/revoke", s.revoke)
	return router
}

func (s *Service) AuthRouter() http.Handler {
	router := chi.NewRouter()
	router.Get("/clients", s.clients)
	router.Get("/providers", s.providers)
	router.Post("/admin/login", s.passwordLogin)
	router.Get("/session", s.session)
	router.Post("/logout", s.logout)
	router.Get("/client-requests/{requestID}", s.clientRequest)
	router.With(s.RequireBrowser).Post("/client-requests/{requestID}/complete", s.completeClientRequest)
	router.Get("/oauth/{connectionID}/start", s.startUpstream)
	router.Get("/oauth/callback", s.upstreamCallback)
	return router
}

func (s *Service) OAuthMetadata(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                s.publicURL,
		"authorization_endpoint":                s.publicURL + "/oauth/authorize",
		"token_endpoint":                        s.publicURL + "/oauth/token",
		"revocation_endpoint":                   s.publicURL + "/oauth/revoke",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
	})
}

func (s *Service) clients(w http.ResponseWriter, _ *http.Request) {
	clients := []Client{Clients["monkeyai-desktop"], Clients["monkeyai-mobile"]}
	writeJSON(w, http.StatusOK, map[string]any{"clients": clients})
}

func (s *Service) authorize(w http.ResponseWriter, r *http.Request) {
	request, err := s.BeginAuthorization(r.Context(), r.URL.Query())
	if err != nil {
		s.writeOAuthError(w, err)
		return
	}
	target := s.adminURL + "/client-login?request_id=" + url.QueryEscape(request.ID)
	http.Redirect(w, r, target, http.StatusFound)
}

func (s *Service) token(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		s.writeOAuthError(w, oauthError("invalid_request", "请求格式无效"))
		return
	}
	var token Token
	var err error
	switch r.Form.Get("grant_type") {
	case "authorization_code":
		token, err = s.ExchangeCode(r.Context(), r.Form.Get("client_id"), r.Form.Get("redirect_uri"), r.Form.Get("code"), r.Form.Get("code_verifier"))
	case "refresh_token":
		token, err = s.Refresh(r.Context(), r.Form.Get("client_id"), r.Form.Get("refresh_token"))
	default:
		err = oauthError("unsupported_grant_type", "不支持的 grant_type")
	}
	if err != nil {
		s.writeOAuthError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, token)
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err == nil {
		_ = s.revokeToken(r.Context(), tokenHash(r.Form.Get("token")), r.Form.Get("client_id"))
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Service) writeOAuthError(w http.ResponseWriter, err error) {
	var protocol protocolError
	if !errors.As(err, &protocol) {
		protocol = protocolError{Code: "server_error", Description: "服务暂时不可用"}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusBadRequest, protocol)
}

func (s *Service) providers(w http.ResponseWriter, r *http.Request) {
	connections, err := s.connections(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "settings_unavailable", "认证配置不可用")
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
	writeJSON(w, http.StatusOK, map[string]any{"providers": result})
}

func (s *Service) session(w http.ResponseWriter, r *http.Request) {
	user, ok := s.BrowserUser(r)
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": ok, "user": nullableUser(user, ok)})
}

func nullableUser(user User, ok bool) any {
	if !ok {
		return nil
	}
	return user
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_ = s.revokeBrowserSession(r.Context(), tokenHash(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) clientRequest(w http.ResponseWriter, r *http.Request) {
	request, err := s.authorizationRequest(r.Context(), chi.URLParam(r, "requestID"))
	if err != nil || request.CompletedAt != nil || !s.now().Before(request.ExpiresAt) {
		writeError(w, http.StatusNotFound, "request_not_found", "授权请求不存在、已完成或已过期")
		return
	}
	connections, _ := s.connections(r.Context())
	user, authenticated := s.BrowserUser(r)
	client := Clients[request.ClientID]
	writeJSON(w, http.StatusOK, map[string]any{
		"request_id":    request.ID,
		"client":        client,
		"authenticated": authenticated,
		"user":          nullableUser(user, authenticated),
		"providers":     publicConnections(connections),
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
	launchURL, err := s.CompleteAuthorization(r.Context(), chi.URLParam(r, "requestID"), user.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "request_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"launch_url": launchURL})
}

func (s *Service) startUpstream(w http.ResponseWriter, r *http.Request) {
	requestID := r.URL.Query().Get("request_id")
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "request_required", "缺少客户端授权请求")
		return
	}
	connectionID := chi.URLParam(r, "connectionID")
	connection, err := s.connection(r.Context(), connectionID)
	if err != nil {
		writeError(w, http.StatusNotFound, "provider_not_found", "登录方式不存在")
		return
	}
	request, err := s.authorizationRequest(r.Context(), requestID)
	if err != nil || request.CompletedAt != nil || !s.now().Before(request.ExpiresAt) {
		writeError(w, http.StatusBadRequest, "request_unavailable", "授权请求无效")
		return
	}
	state, err := randomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "无法发起登录")
		return
	}
	if err := s.createLoginState(r.Context(), tokenHash(state), connectionID, requestID, s.now().Add(s.requestTTL)); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "无法发起登录")
		return
	}
	target, err := s.upstreamAuthorizeURL(r.Context(), connection, state)
	if err != nil {
		writeError(w, http.StatusBadGateway, "provider_unavailable", err.Error())
		return
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (s *Service) upstreamCallback(w http.ResponseWriter, r *http.Request) {
	state, err := s.consumeLoginState(r.Context(), tokenHash(r.URL.Query().Get("state")))
	if err != nil || r.URL.Query().Get("code") == "" {
		http.Redirect(w, r, s.clientLoginURL("", "oauth_callback"), http.StatusFound)
		return
	}
	connection, err := s.connection(r.Context(), state.ConnectionID)
	if err != nil {
		http.Redirect(w, r, s.clientLoginURL(state.AuthorizationRequestID, "provider_unavailable"), http.StatusFound)
		return
	}
	profile, err := s.exchangeUpstream(r.Context(), connection, r.URL.Query().Get("code"))
	if err != nil {
		http.Redirect(w, r, s.clientLoginURL(state.AuthorizationRequestID, "oauth_exchange"), http.StatusFound)
		return
	}
	user, err := s.upsertIdentity(r.Context(), profile)
	if err != nil {
		code := "user_unavailable"
		if errors.Is(err, ErrAdminPasswordRequired) {
			code = "admin_password_required"
		}
		http.Redirect(w, r, s.clientLoginURL(state.AuthorizationRequestID, code), http.StatusFound)
		return
	}
	token, err := randomToken(32)
	if err != nil || s.createBrowserSession(r.Context(), user.ID, tokenHash(token), "oauth", s.now().Add(s.sessionTTL)) != nil {
		http.Redirect(w, r, s.clientLoginURL(state.AuthorizationRequestID, "session_failed"), http.StatusFound)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode, MaxAge: int(s.sessionTTL.Seconds())})
	http.Redirect(w, r, s.clientLoginURL(state.AuthorizationRequestID, ""), http.StatusFound)
}

func (s *Service) clientLoginURL(requestID, errorCode string) string {
	query := url.Values{}
	if requestID != "" {
		query.Set("request_id", requestID)
	}
	if errorCode != "" {
		query.Set("error", errorCode)
	}
	return s.adminURL + "/client-login?" + query.Encode()
}
