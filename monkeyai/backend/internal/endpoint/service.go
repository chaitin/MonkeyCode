package endpoint

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Credential struct {
	UserID, Reference string
	ExpiresAt         time.Time
}
type Authenticator interface {
	Credential(*http.Request) (Credential, bool)
	Valid(context.Context, Credential) (bool, error)
}

type bucket struct {
	tokens float64
	at     time.Time
}

func (b *bucket) allow(now time.Time, n, rate, capacity float64) bool {
	if b.at.IsZero() {
		b.tokens = capacity
	} else {
		b.tokens = min(capacity, b.tokens+now.Sub(b.at).Seconds()*rate)
	}
	b.at = now
	if b.tokens < n {
		return false
	}
	b.tokens -= n
	return true
}

type userState struct {
	lock                      chan struct{}
	refs                      int
	idleVersion               uint64
	timer                     *time.Timer
	loaded                    bool
	endpoints                 map[string]Endpoint
	connections               map[string]*connection
	messages, bytes, upgrades bucket
}

func (u *userState) enter(ctx context.Context) error {
	select {
	case u.lock <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (u *userState) leave() { <-u.lock }

type Service struct {
	store                                                                Store
	auth                                                                 Authenticator
	logger                                                               *slog.Logger
	origin                                                               string
	mu                                                                   sync.Mutex
	users                                                                map[string]*userState
	connections                                                          map[*connection]struct{}
	draining                                                             atomic.Bool
	maxConnections                                                       int
	slots                                                                int
	pingInterval, timePong, verifyInterval, timeDB, timeWrite, timeHello time.Duration
	stats                                                                counters
}
type counters struct{ messages, bytes, rejected, handshakes, limited, verifications, verifyNanos atomic.Uint64 }

func NewService(store Store, auth Authenticator, logger *slog.Logger, publicURL string) *Service {
	return &Service{store: store, auth: auth, logger: logger, origin: publicURL, users: make(map[string]*userState), connections: make(map[*connection]struct{}), maxConnections: 1000, pingInterval: 30 * time.Second, timePong: 10 * time.Second, verifyInterval: 30 * time.Second, timeDB: 5 * time.Second, timeWrite: 10 * time.Second, timeHello: 5 * time.Second}
}
func (s *Service) WithMaxConnections(n int) *Service {
	if n > 0 {
		s.maxConnections = n
	}
	return s
}
func (s *Service) Ready() bool { return !s.draining.Load() }

func (s *Service) acquire(user string) *userState {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.users[user]
	if u == nil {
		u = &userState{lock: make(chan struct{}, 1), endpoints: make(map[string]Endpoint), connections: make(map[string]*connection)}
		s.users[user] = u
	}
	if u.timer != nil {
		u.timer.Stop()
		u.timer = nil
	}
	u.refs++
	u.idleVersion++
	return u
}
func (s *Service) release(user string, u *userState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u.refs--
	if u.refs == 0 {
		if s.draining.Load() {
			delete(s.users, user)
			return
		}
		version := u.idleVersion
		u.timer = time.AfterFunc(2*time.Second, func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if u.refs == 0 && u.idleVersion == version && s.users[user] == u {
				delete(s.users, user)
			}
		})
	}
}
func (s *Service) load(ctx context.Context, user string, u *userState) error {
	if u.loaded {
		return nil
	}
	rows, err := s.store.Active(ctx, user)
	if err != nil {
		return err
	}
	for _, row := range rows {
		u.endpoints[row.MachineID] = row
	}
	u.loaded = true
	return nil
}
func (s *Service) view(u *userState, e Endpoint) Endpoint {
	if c := u.connections[e.MachineID]; c != nil && c.valid() {
		e.Online = true
		seen := c.seen.Load()
		e.LastSeenAt = &seen
	}
	return e
}
func (s *Service) broadcast(userID string, u *userState) {
	rows := make([]View, 0, len(u.endpoints))
	for _, e := range u.endpoints {
		rows = append(rows, s.view(u, e).View)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].MachineID < rows[j].MachineID })
	data, err := json.Marshal(struct {
		Type      string `json:"type"`
		Endpoints []View `json:"endpoints"`
	}{"directory.snapshot", rows})
	if err != nil {
		s.logger.Error("序列化端点目录失败", "user_id", userID, "operation", "broadcast", "error", err)
		return
	}
	for _, c := range u.connections {
		c.snapshot(data)
	}
}
func (s *Service) route(c *connection, m Message, size int) {
	u := c.user
	ctx, cancel := context.WithTimeout(c.ctx, s.timeDB)
	defer cancel()
	if err := u.enter(ctx); err != nil {
		if !c.dead.Load() && !c.expected(err) {
			s.logger.Warn("端点路由获取锁失败", "user_id", c.credential.UserID, "machine_id", c.machine, "operation", "route", "error", err)
		}
		c.stop(1013)
		return
	}
	defer u.leave()
	if s.draining.Load() {
		c.stop(1012)
		return
	}
	if !c.valid() {
		c.stop(4003)
		return
	}
	if u.connections[c.machine] != c {
		c.stop(4001)
		return
	}
	now := time.Now()
	if !c.messages.allow(now, 1, 60, 60) || !c.bytes.allow(now, float64(size), 1<<20, 1<<20) || !u.messages.allow(now, 1, 240, 240) || !u.bytes.allow(now, float64(size), 4<<20, 4<<20) {
		c.reject("rate_limited", m.ID)
		s.stats.limited.Add(1)
		if c.limited.IsZero() {
			c.limited = now
		} else if now.Sub(c.limited) >= 10*time.Second {
			c.stop(1008)
		}
		return
	}
	c.limited = time.Time{}
	if _, ok := u.endpoints[m.Target]; !ok {
		c.reject("target_unavailable", m.ID)
		return
	}
	target := u.connections[m.Target]
	if target == nil || !target.valid() {
		c.reject("target_offline", m.ID)
		return
	}
	m.Source = c.machine
	m.RoutedAt = now.UnixMilli()
	data, err := json.Marshal(m)
	if err != nil {
		s.logger.Error("序列化端点转发消息失败", "user_id", c.credential.UserID, "machine_id", c.machine, "message_id", m.ID, "operation", "route", "error", err)
		c.reject("invalid_message", m.ID)
		return
	}
	if len(data) > maxMessage {
		c.reject("payload_too_large", m.ID)
		return
	}
	if !target.enqueue(data) {
		c.reject("target_busy", m.ID)
		return
	}
	s.stats.messages.Add(1)
	s.stats.bytes.Add(uint64(len(data)))
}

func (s *Service) Shutdown(ctx context.Context) error {
	s.draining.Store(true)
	s.mu.Lock()
	all := make([]*connection, 0, len(s.connections))
	for c := range s.connections {
		all = append(all, c)
		c.stop(1012)
	}
	for _, u := range s.users {
		if u.timer != nil {
			u.timer.Stop()
		}
	}
	s.mu.Unlock()
	for _, c := range all {
		select {
		case <-c.finished:
		case <-ctx.Done():
			for _, pending := range all {
				pending.ws.CloseNow()
				pending.cancel()
			}
			return ctx.Err()
		}
	}
	s.logger.Info("端点桥接已停止", "messages", s.stats.messages.Load(), "bytes", s.stats.bytes.Load(), "rejected", s.stats.rejected.Load(), "handshake_failures", s.stats.handshakes.Load())
	return nil
}

func (s *Service) check(ctx context.Context, credential Credential) (int, error) {
	start := time.Now()
	defer func() { s.stats.verifications.Add(1); s.stats.verifyNanos.Add(uint64(time.Since(start))) }()
	if !time.Now().Before(credential.ExpiresAt) {
		return 4003, nil
	}
	checkCtx, cancel := context.WithTimeout(ctx, s.timeDB)
	defer cancel()
	valid, err := s.auth.Valid(checkCtx, credential)
	if err != nil {
		return 1013, err
	}
	if !valid {
		return 4003, nil
	}
	return 0, nil
}
func status(err error) (int, string) {
	var f fault
	if errors.As(err, &f) {
		switch f.code {
		case "unauthorized":
			return 401, f.code
		case "endpoint_not_found":
			return 404, f.code
		case "endpoint_limit_exceeded":
			return 409, f.code
		case "endpoint_revoked":
			return 409, f.code
		}
	}
	return http.StatusServiceUnavailable, "service_unavailable"
}
