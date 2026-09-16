package endpoint

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	router.Route("/endpoints", func(r chi.Router) {
		r.Get("/connect", s.connect)
		r.Get("/", s.list)
		r.Get("/{machine}", s.get)
		r.Patch("/{machine}", func(w http.ResponseWriter, r *http.Request) { s.update(w, r, "rename") })
		r.Post("/{machine}/revoke", func(w http.ResponseWriter, r *http.Request) { s.update(w, r, "revoke") })
		r.Post("/{machine}/restore", func(w http.ResponseWriter, r *http.Request) { s.update(w, r, "restore") })
	})
}
func respond(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}
func failure(w http.ResponseWriter, code int, name string) {
	respond(w, code, map[string]any{"error": map[string]string{"code": name, "message": map[string]string{"invalid_request": "请求参数无效", "invalid_token": "凭据无效", "endpoint_not_found": "端点不存在", "endpoint_limit_exceeded": "端点数量达到上限", "service_unavailable": "服务暂不可用", "forbidden": "请求来源不受信任", "rate_limited": "请求过于频繁"}[name]}})
}
func (s *Service) credential(w http.ResponseWriter, r *http.Request) (Credential, bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	c, ok := s.auth.Credential(r)
	if !ok || !time.Now().Before(c.ExpiresAt) {
		failure(w, 401, "invalid_token")
		return c, false
	}
	if s.draining.Load() {
		failure(w, 503, "service_unavailable")
		return c, false
	}
	return c, true
}
func pageParam(r *http.Request, key string, fallback, max int) (int, bool) {
	if !r.URL.Query().Has(key) {
		return fallback, true
	}
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	return n, err == nil && n > 0 && n <= max
}
func (s *Service) manage(w http.ResponseWriter, r *http.Request, fn func(context.Context, string, *userState) (any, error)) {
	credential, ok := s.credential(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.timeDB)
	defer cancel()
	u := s.acquire(credential.UserID)
	defer s.release(credential.UserID, u)
	if err := u.enter(ctx); err != nil {
		failure(w, 503, "service_unavailable")
		return
	}
	defer u.leave()
	if s.draining.Load() {
		failure(w, 503, "service_unavailable")
		return
	}
	if err := s.load(ctx, credential.UserID, u); err != nil {
		failure(w, 503, "service_unavailable")
		return
	}
	result, err := fn(ctx, credential.UserID, u)
	if err != nil {
		code, name := status(err)
		failure(w, code, name)
		return
	}
	respond(w, 200, result)
}
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	page, ok := pageParam(r, "page", 1, 1000000)
	size, okSize := pageParam(r, "page_size", 20, 100)
	if !ok || !okSize {
		failure(w, 400, "invalid_request")
		return
	}
	s.manage(w, r, func(ctx context.Context, user string, u *userState) (any, error) {
		result, err := s.store.Page(ctx, user, page, size)
		for i, e := range result.Items {
			result.Items[i] = s.view(u, e)
		}
		return result, err
	})
}
func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	machine := chi.URLParam(r, "machine")
	if !validID(machine) {
		failure(w, 400, "invalid_request")
		return
	}
	s.manage(w, r, func(ctx context.Context, user string, u *userState) (any, error) {
		e, err := s.store.Get(ctx, user, machine)
		return s.view(u, e), err
	})
}
func (s *Service) update(w http.ResponseWriter, r *http.Request, action string) {
	machine := chi.URLParam(r, "machine")
	if !validID(machine) {
		failure(w, 400, "invalid_request")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	if err != nil {
		failure(w, 400, "invalid_request")
		return
	}
	var alias *string
	if action == "rename" {
		fields, err := object(data)
		raw, ok := fields["alias"]
		if err != nil || !ok || len(fields) != 1 || json.Unmarshal(raw, &alias) != nil || (alias != nil && !text(*alias, 128)) {
			failure(w, 400, "invalid_request")
			return
		}
	} else if strings.TrimSpace(string(data)) != "" {
		failure(w, 400, "invalid_request")
		return
	}
	s.manage(w, r, func(ctx context.Context, user string, u *userState) (any, error) {
		e, err := s.store.Update(ctx, user, machine, action, alias, 20)
		if err != nil {
			return nil, err
		}
		if e.Status == "revoked" {
			delete(u.endpoints, machine)
			if old := u.connections[machine]; old != nil {
				old.stop(4002)
				delete(u.connections, machine)
			}
		} else {
			u.endpoints[machine] = e
		}
		s.broadcast(u)
		return s.view(u, e), nil
	})
}
func origin(value string) string {
	u, err := url.Parse(value)
	if err != nil || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" && !((u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443")) {
		host += ":" + port
	}
	return u.Scheme + "://" + host
}
func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	credential, ok := s.credential(w, r)
	if !ok {
		return
	}
	if values := r.Header.Values("Origin"); len(values) > 0 {
		o := values[0]
		parsed, err := url.Parse(o)
		if len(values) != 1 || err != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || origin(o) == "" || origin(o) != origin(s.origin) {
			failure(w, 403, "forbidden")
			return
		}
	}
	u := s.acquire(credential.UserID)
	defer s.release(credential.UserID, u)
	ctx, cancel := context.WithTimeout(r.Context(), s.timeDB)
	err := u.enter(ctx)
	cancel()
	if err != nil {
		failure(w, 503, "service_unavailable")
		return
	}
	allowed := u.upgrades.allow(time.Now(), 1, 10, 20)
	u.leave()
	if !allowed {
		w.Header().Set("Retry-After", "1")
		failure(w, 429, "rate_limited")
		return
	}
	s.mu.Lock()
	if s.draining.Load() || s.slots >= s.maxConnections {
		s.mu.Unlock()
		w.Header().Set("Retry-After", "1")
		failure(w, 503, "service_unavailable")
		return
	}
	s.slots++
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.slots--; s.mu.Unlock() }()
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		s.stats.handshakes.Add(1)
		return
	}
	ctx, cancel = context.WithCancel(r.Context())
	c := &connection{service: s, ws: ws, credential: credential, user: u, ctx: ctx, cancel: cancel, done: make(chan struct{}), ready: make(chan struct{}), finished: make(chan struct{}), wake: make(chan struct{}, 1)}
	s.mu.Lock()
	if s.draining.Load() {
		s.mu.Unlock()
		cancel()
		ws.CloseNow()
		return
	}
	s.connections[c] = struct{}{}
	s.mu.Unlock()
	var workers sync.WaitGroup
	workers.Go(c.writer)
	defer func() {
		c.stop(1000)
		workers.Wait()
		cancel()
		ws.CloseNow()
		cleanup, cancel := context.WithTimeout(context.Background(), s.timeDB)
		defer cancel()
		// 清理必须完成，不能因管理操作持锁而遗留一个永久离线连接。
		_ = u.enter(context.Background())
		if u.connections[c.machine] == c {
			delete(u.connections, c.machine)
			if e, ok := u.endpoints[c.machine]; ok {
				seen := c.seen.Load()
				e.LastSeenAt = &seen
				u.endpoints[c.machine] = e
			}
			s.broadcast(u)
		}
		u.leave()
		if c.machine != "" {
			_ = s.store.Touch(cleanup, credential.UserID, c.machine, time.UnixMilli(c.seen.Load()))
		}
		s.mu.Lock()
		delete(s.connections, c)
		s.mu.Unlock()
		s.logger.Info("端点连接关闭", "user_id", credential.UserID, "machine_id", c.machine, "close_code", c.code.Load())
		close(c.finished)
	}()
	ws.SetReadLimit(4096)
	helloTimer := time.AfterFunc(s.timeHello, func() { c.stop(1002) })
	kind, data, err := ws.Read(ctx)
	helloTimer.Stop()
	if err != nil {
		s.stats.handshakes.Add(1)
		c.stop(1002)
		return
	}
	if kind != websocket.MessageText {
		c.stop(1002)
		return
	}
	if !utf8.Valid(data) {
		c.stop(1007)
		return
	}
	h, err := hello(data)
	if err != nil {
		name := "invalid_message"
		var f fault
		if errors.As(err, &f) {
			name = f.code
		}
		c.write(errorFrame(name, ""))
		s.stats.handshakes.Add(1)
		c.stop(1002)
		return
	}
	checkCtx, checkCancel := context.WithTimeout(ctx, s.timeDB)
	defer checkCancel()
	if err = u.enter(checkCtx); err != nil {
		c.stop(1013)
		return
	}
	code, _ := s.check(checkCtx, credential)
	if code != 0 || s.draining.Load() || c.dead.Load() {
		u.leave()
		if code == 0 {
			code = 1012
		}
		c.stop(code)
		return
	}
	if err = s.load(checkCtx, credential.UserID, u); err == nil {
		var e Endpoint
		e, err = s.store.Register(checkCtx, credential.UserID, h, 20)
		if err == nil && !c.valid() {
			err = fault{"unauthorized"}
		}
		if err == nil && s.draining.Load() {
			err = fault{"service_unavailable"}
		}
		if err == nil {
			c.machine = h.MachineID
			c.seen.Store(time.Now().UnixMilli())
			if old := u.connections[c.machine]; old != nil {
				old.stop(4001)
			}
			u.connections[c.machine] = c
			u.endpoints[c.machine] = e
			s.broadcast(u)
		}
	}
	u.leave()
	if err != nil {
		_, name := status(err)
		if name == "endpoint_not_found" {
			name = "unauthorized"
		}
		c.write(errorFrame(name, ""))
		s.stats.handshakes.Add(1)
		code := 1013
		if name == "unauthorized" {
			code = 4003
		}
		if name == "endpoint_revoked" {
			code = 4002
		}
		if name == "endpoint_limit_exceeded" {
			code = 1008
		}
		c.stop(code)
		return
	}
	ws.SetReadLimit(maxMessage)
	close(c.ready)
	workers.Go(c.ping)
	workers.Go(c.verify)
	c.reader()
}
