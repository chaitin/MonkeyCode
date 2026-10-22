package relay

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
)

func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	return io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
}
func isMissing(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func routeScope(method, p string) (string, bool, bool) {
	switch {
	case p == "/terminal":
		return "session:control", true, method == http.MethodGet
	case p == "/acp":
		return "session:read", false, method == http.MethodGet
	case p == "/read/session":
		return "session:read", true, method == http.MethodPost
	case p == "/read/config":
		return "resources:manage", true, method == http.MethodPost
	case p == "/read/interaction":
		return "session:control", true, method == http.MethodPost
	case p == "/write/resource":
		return "resources:manage", true, method == http.MethodPost
	case strings.HasPrefix(p, "/cap/") && strings.HasSuffix(p, "/mcp"):
		parts := strings.Split(strings.Trim(p, "/"), "/")
		return "files:read", true, len(parts) == 3 && slices.Contains([]string{"GET", "POST", "DELETE"}, method)
	case strings.HasPrefix(p, "/uploads/"):
		parts := strings.Split(strings.Trim(p, "/"), "/")
		return "files:write", true, len(parts) == 2 && slices.Contains([]string{"PUT", "HEAD"}, method)
	case strings.HasPrefix(p, "/files/"):
		return "files:read", true, method == "GET" || method == "HEAD"
	default:
		return "", false, false
	}
}

func safePath(value string) bool {
	return strings.HasPrefix(value, "/") && !strings.ContainsAny(value, "\\\x00") && path.Clean(value) == value && !strings.Contains(value, "//")
}

// chi 在 RawPath 存在时提供转义后的路由参数，否则参数已经解码。
func requestPath(r *http.Request, value string) (string, error) {
	if r.URL.RawPath == "" {
		return value, nil
	}
	lower := strings.ToLower(value)
	if strings.Contains(lower, "%2f") || strings.Contains(lower, "%5c") {
		return "", errProtocol
	}
	return url.PathUnescape(value)
}

func (s *Service) proxyOrigin(origin string) bool {
	if origin == "" || origin == s.config.PublicURL || origin == "app://monkeyai" {
		return true
	}
	return slices.Contains(s.config.DesktopOrigins, origin)
}

func responseTimeout(p string) time.Duration {
	if strings.HasPrefix(p, "/read/") {
		return 150 * time.Second
	}
	if p == "/write/resource" {
		return 225 * time.Second
	}
	return 30 * time.Second
}

func (s *Service) proxy(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
	w = wrapped
	defer func() {
		if wrapped.Status() >= 400 {
			logging.Event(r.Context(), s.logger, slog.LevelDebug, "relay.request.rejected", "远程代理请求拒绝", "request_id", logging.RequestID(r.Context()), "route", "/proxy/*", "method", r.Method, "status", wrapped.Status(), "duration_ms", time.Since(started).Milliseconds())
		}
	}()
	if s.draining.Load() {
		failure(r.Context(), w, 503, "device_draining")
		return
	}
	machine := chi.URLParam(r, "machine")
	p, pathErr := requestPath(r, "/"+chi.URLParam(r, "*"))
	if pathErr != nil || !validUUID(machine) || !safePath(p) {
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	terminal := p == "/terminal"
	var terminalTicket string
	if terminal {
		var valid bool
		terminalTicket, _, valid = terminalHandshake(r)
		if !valid {
			failure(r.Context(), w, 400, "invalid_request")
			return
		}
	} else if strings.HasPrefix(p, "/terminal/") {
		failure(r.Context(), w, 404, "not_found")
		return
	}
	if origin := r.Header.Get("Origin"); !s.proxyOrigin(origin) {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	if strings.HasPrefix(p, "/uploads/") {
		if r.ContentLength > 64<<20 {
			failure(r.Context(), w, 413, "invalid_request")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Expose-Headers", "Upload-Session-ID,Upload-Offset,Upload-Length,Mcp-Session-Id,MCP-Protocol-Version,Last-Event-ID,ETag,Last-Modified,Content-Length,Content-Range,Accept-Ranges,X-Request-ID")
	}
	if r.Method == http.MethodOptions {
		_, _, allowed := routeScope(r.Header.Get("Access-Control-Request-Method"), p)
		if !allowed {
			failure(r.Context(), w, 403, "permission_denied")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Range,Mcp-Session-Id,MCP-Protocol-Version,Last-Event-ID,Upload-Session-ID,Upload-Offset,Upload-Length")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	scope, data, allowed := routeScope(r.Method, p)
	if !allowed {
		if terminal {
			failure(r.Context(), w, 400, "invalid_request")
		} else {
			failure(r.Context(), w, 403, "permission_denied")
		}
		return
	}

	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	protocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
	remaining := make([]string, 0, len(protocols))
	if terminal {
		raw = terminalTicket
		remaining = append(remaining, terminalProtocol)
	} else {
		for _, protocol := range protocols {
			protocol = strings.TrimSpace(protocol)
			if strings.HasPrefix(protocol, "monkeyai.token.") {
				if raw != "" {
					failure(r.Context(), w, 400, "invalid_request")
					return
				}
				raw = strings.TrimPrefix(protocol, "monkeyai.token.")
			} else if protocol == "monkeyai.v1" {
				remaining = append(remaining, protocol)
			}
		}
	}
	if raw == "" || len(raw) > 128 {
		failure(r.Context(), w, 401, "connection_expired")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	found, err := sqlc.New(s.pool).FindTicket(ctx, sqlc.FindTicketParams{MachineID: machine, TicketHash: secretHash(raw)})
	if err != nil {
		cancel()
		if isMissing(err) {
			failure(r.Context(), w, 401, "connection_expired")
		} else {
			failure(r.Context(), w, 503, "authorization_state_unavailable")
		}
		return
	}
	row, err := sqlc.New(s.pool).GetConnection(ctx, found.ID)
	cancel()
	if err != nil {
		if isMissing(err) {
			failure(r.Context(), w, 401, "connection_expired")
		} else {
			failure(r.Context(), w, 503, "authorization_state_unavailable")
		}
		return
	}
	if !slices.Contains(row.Scopes, scope) || p == "/write/resource" && !slices.Contains(row.Scopes, "session:read") {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	current := s.current(target{found.UserID, machine})
	if current == nil || current.state.GrantVersion != row.GrantVersion {
		failure(r.Context(), w, 503, "device_offline")
		return
	}
	fileExpiry := time.Time{}
	if strings.HasPrefix(p, "/files/") {
		parts := strings.SplitN(strings.TrimPrefix(p, "/files/"), "/", 2)
		if len(parts) != 2 {
			failure(r.Context(), w, 403, "permission_denied")
			return
		}
		fileCtx, fileCancel := context.WithTimeout(r.Context(), 5*time.Second)
		grant, _, fileErr := s.verifyFile(fileCtx, machine, parts[0], "/"+parts[1])
		fileCancel()
		if fileErr != nil {
			fail(r.Context(), w, fileErr)
			return
		}
		if grant.OwnerUserID != row.UserID || grant.ConnectionID != "" && (grant.ConnectionID != row.ID || grant.ClientGrantID != row.ClientGrantID || grant.AccessVersion != row.AccessVersion || grant.LeaseEpoch != current.state.LeaseEpoch || !slices.Equal(grant.Scopes, row.Scopes)) {
			failure(r.Context(), w, 403, "permission_denied")
			return
		}
		fileExpiry = grant.ExpiresAt
	}
	if p == "/acp" && !slices.Equal(remaining, []string{"monkeyai.v1"}) && len(remaining) != 0 {
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	if p == "/acp" && !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	r = r.Clone(r.Context())
	r.Header = r.Header.Clone()
	if len(remaining) > 0 {
		r.Header.Set("Sec-WebSocket-Protocol", strings.Join(remaining, ", "))
	} else {
		r.Header.Del("Sec-WebSocket-Protocol")
	}
	a := &access{started: started, id: row.ID, clientGrant: row.ClientGrantID, scopes: slices.Clone(row.Scopes), grantVersion: row.GrantVersion, accessVersion: row.AccessVersion, ticketVersion: row.TicketVersion, verifiedAt: time.Now(), expiresAt: row.ExpiresAt}
	if !fileExpiry.IsZero() {
		a.expiresAt = minTime(a.expiresAt, fileExpiry)
		a.fileExpiresAt = fileExpiry
	}
	assertion, err := signWire(s.key, s.kid, map[string]any{"type": "monkeyai.access.assertion.v1", "issuer": s.config.PublicURL, "audience": "monkeyai-runtime", "kid": s.kid,
		"authorization": map[string]any{"server_id": s.config.ServerID, "owner_user_id": row.UserID, "machine_id": machine, "connection_id": row.ID, "client_grant_id": row.ClientGrantID,
			"grant_version": row.GrantVersion, "access_version": row.AccessVersion, "lease_epoch": current.state.LeaseEpoch, "scopes": row.Scopes}, "expires_at": row.ExpiresAt.UTC().Format(time.RFC3339Nano)})
	if err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	s.forward(w, r, current, a, data, p, assertion, !fileExpiry.IsZero())
}

func (s *Service) forward(w http.ResponseWriter, r *http.Request, route *route, a *access, data bool, p, assertion string, download bool) {
	if s.draining.Load() {
		failure(r.Context(), w, 503, "device_draining")
		return
	}
	headerBytes := 0
	for key, values := range r.Header {
		headerBytes += len(key)
		for _, value := range values {
			headerBytes += len(value)
		}
	}
	if headerBytes > 64<<10 {
		failure(r.Context(), w, 431, "invalid_request")
		return
	}
	started := time.Now()
	label := p
	terminal := p == "/terminal"
	if terminal {
		label = "/api/v1/endpoints/{machine}/proxy/terminal"
	}
	candidate := terminal && r.URL.RawQuery != ""
	reason := "closed"
	var permit *dataPermit
	for _, prefix := range []string{"/files/", "/uploads/", "/cap/"} {
		if strings.HasPrefix(p, prefix) {
			label = prefix + "*"
			break
		}
	}
	operation := "acp"
	if terminal {
		operation = "terminal"
	}
	for prefix, name := range map[string]string{"/read/session": "read_session", "/read/config": "read_config", "/read/interaction": "read_interaction", "/write/resource": "write_resource", "/files/": "read_file", "/uploads/": "upload_file", "/cap/": "mcp_capability"} {
		if strings.HasPrefix(p, prefix) {
			operation = name
			break
		}
	}
	logging.Bind(r.Context(), slog.String("server_id", s.config.ServerID), slog.String("user_id", route.target.user),
		slog.String("machine_id", route.target.machine), slog.String("boot_id", route.hello.BootID), slog.String("connection_id", a.id),
		slog.String("operation", operation), slog.String("phase", "proxy_response"))
	defer func() {
		fault := recover()
		result := "completed"
		if fault != nil {
			result = "aborted"
		}
		if r.Context().Err() != nil {
			result = "canceled"
		}
		if reason == "closed" {
			a.mu.Lock()
			reason = a.reason
			a.mu.Unlock()
		}
		budgetState := slog.GroupValue()
		if permit != nil {
			b := permit.budget
			b.mu.Lock()
			budgetState = slog.GroupValue(slog.Int("regular", b.regularCount), slog.Int("terminal", b.terminalCount), slog.Bool("candidate_active", b.candidate != nil), slog.Bool("candidate_category", permit.candidate))
			b.mu.Unlock()
		}
		logging.Event(r.Context(), s.logger, slog.LevelDebug, "relay.stream.completed", "远程代理流结束", "module", "relay", "operation", operation, "server_id", s.config.ServerID, "user_id", route.target.user, "machine_id", route.target.machine, "boot_id", route.hello.BootID, "lease_epoch", route.state.LeaseEpoch, "connection_id", a.id, "access_version", a.accessVersion, "grant_version", a.grantVersion, "channel_data", data, "candidate_requested", candidate, "method", r.Method, "route", label, "reason", reason, "remaining_budget", budgetState, "duration_ms", time.Since(started).Milliseconds(), "metrics", s.metricValues(), "transport_result", result, "result", "unknown")
		if fault != nil {
			panic(fault)
		}
	}()
	s.mu.Lock()
	mux, slots := streamSession(route, data)
	budget, opens := route.dataBudget, route.opensControl
	active := s.routes[route.target] == route && route.ready && route.runtimeStatus == "online"
	s.mu.Unlock()
	if !active || mux == nil || mux.IsClosed() || data && budget == nil {
		reason = "device_offline"
		failure(r.Context(), w, 503, "device_offline")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	a.cancel = cancel
	defer cancel()
	if data {
		permit = budget.reserve(terminal, candidate, func() { a.closeReason("candidate_timeout") })
		if permit == nil {
			reason = "limit_reached"
			w.Header().Set("Retry-After", "1")
			code := "relay_overloaded"
			if terminal {
				code = "terminal_limit_reached"
			}
			failure(r.Context(), w, 429, code)
			return
		}
		defer permit.release()
		opens = budget.opens
	} else {
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			reason = "limit_reached"
			s.metrics.limited.Add(1)
			w.Header().Set("Retry-After", "1")
			failure(r.Context(), w, 429, "relay_overloaded")
			return
		}
	}
	defer a.close()
	var handshakeTimer *time.Timer
	if terminal {
		handshakeTimer = time.AfterFunc(8*time.Second-time.Since(a.started), func() { a.closeReason("handshake_timeout") })
		defer handshakeTimer.Stop()
	}
	s.mu.Lock()
	if data && route.data != mux {
		s.mu.Unlock()
		reason = "data_replaced"
		failure(r.Context(), w, 503, "device_offline")
		return
	}
	if s.routes[route.target] != route || !route.ready || a.id != "" && (route.connectionVersions[a.id].version > a.ticketVersion && a.ticketVersion != 0 || route.connectionVersions[a.id].accessVersion > a.accessVersion) {
		s.mu.Unlock()
		reason = "connection_expired"
		failure(r.Context(), w, 401, "connection_expired")
		return
	}
	route.streams[a] = struct{}{}
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(route.streams, a); s.mu.Unlock() }()
	transport := &http.Transport{DisableKeepAlives: true, ForceAttemptHTTP2: false, MaxResponseHeaderBytes: 64 << 10, ResponseHeaderTimeout: responseTimeout(p),
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			stream, err := s.openStream(ctx, mux, opens, a, permit)
			if err != nil {
				s.metrics.openFailed.Add(1)
			}
			return stream, err
		}}
	defer transport.CloseIdleConnections()
	destination := &url.URL{Scheme: "http", Host: "device.internal", Path: p}
	proxy := &httputil.ReverseProxy{ErrorLog: logging.ErrorLog(s.logger), Transport: transport, FlushInterval: -1, BufferPool: relayBuffers{},
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(destination)
			request.Out.URL.Path = p
			request.Out.URL.RawPath = ""
			request.Out.URL.RawQuery = r.URL.RawQuery
			request.Out.Host = "device.internal"
			for key := range request.Out.Header {
				if strings.HasPrefix(strings.ToLower(key), "x-mai-") || strings.HasPrefix(strings.ToLower(key), "x-monkeyai-") || strings.HasPrefix(strings.ToLower(key), "x-forwarded-") {
					request.Out.Header.Del(key)
				}
			}
			for _, key := range []string{"Authorization", "Cookie", "Forwarded", "Proxy-Authorization"} {
				request.Out.Header.Del(key)
			}
			request.Out.Header.Set("X-MonkeyAI-Access", assertion)
			if terminal {
				request.Out.URL.RawQuery = ""
				if candidate {
					request.Out.URL.RawQuery = "reattach=1"
				}
				request.Out.Header.Set("Sec-WebSocket-Protocol", terminalProtocol)
				request.Out.Header.Del("Sec-WebSocket-Extensions")
			}
		},
		ModifyResponse: func(response *http.Response) error {
			if id := logging.RequestID(r.Context()); id != "" {
				response.Header.Set("X-Request-ID", id)
			}
			if terminal {
				if response.StatusCode == http.StatusSwitchingProtocols && !validTerminalUpgrade(response, r.Header.Get("Sec-WebSocket-Key")) {
					response.Body.Close()
					return errors.New("执行端终端 Upgrade 无效")
				}
				handshakeTimer.Stop()
				logging.Event(r.Context(), s.logger, slog.LevelInfo, "relay.terminal.handshake", "远程终端握手完成", "request_id", logging.RequestID(r.Context()), "machine_id", route.target.machine, "connection_id", a.id, "lease_epoch", route.state.LeaseEpoch, "status", response.StatusCode, "candidate_requested", candidate, "duration_ms", time.Since(a.started).Milliseconds(), "metrics", s.metricValues())
			}
			if response.StatusCode == http.StatusSwitchingProtocols {
				body, ok := response.Body.(io.ReadWriteCloser)
				if !ok {
					return errors.New("执行端 Upgrade 无双向流")
				}
				response.Body = upgradeBody{body}
			}
			logging.Event(r.Context(), s.logger, slog.LevelDebug, "relay.operation.debug", "远程代理响应", "module", "relay", "operation", operation, "machine_id", route.target.machine, "connection_id", a.id, "route", label, "status", response.StatusCode, "content_length", response.ContentLength)
			if response.StatusCode >= 300 && response.StatusCode < 400 && (download || strings.HasPrefix(r.URL.Path, "/preview/")) {
				return errors.New("文件或预览禁止重定向")
			}
			response.Header.Del("Set-Cookie")
			if strings.HasPrefix(r.URL.Path, "/preview/") {
				for _, key := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only", "Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy", "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Clear-Site-Data", "Service-Worker-Allowed", "X-Frame-Options"} {
					response.Header.Del(key)
				}
				for _, key := range []string{"Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy", "Access-Control-Allow-Origin"} {
					response.Header.Set(key, w.Header().Get(key))
				}
				response.Header.Del("Content-Disposition")
			}
			response.Header.Set("Cache-Control", "no-store")
			if download {
				response.Header.Set("Content-Disposition", "attachment")
				response.Header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
				response.Header.Set("X-Content-Type-Options", "nosniff")
				response.Header.Set("Referrer-Policy", "no-referrer")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			reason = "upstream_failed_or_canceled"
			if r.Context().Err() == nil && !errors.Is(err, context.Canceled) {
				logging.Diagnostic(r.Context(), s.logger, slog.LevelError, "relay.stream.failed", err,
					slog.String("operation", operation), slog.String("phase", "proxy_response"))
			} else {
				logging.Expected(r.Context())
			}
			failure(r.Context(), w, 503, "device_offline")
		},
	}
	proxy.ServeHTTP(w, r.WithContext(ctx))
	if mux.IsClosed() {
		reason = "tunnel_disconnected"
	} else if r.Context().Err() != nil {
		reason = "caller_canceled"
	}
}

type relayBuffers struct{}

func (relayBuffers) Get() []byte { return make([]byte, 32<<10) }
func (relayBuffers) Put([]byte)  {}
