package relay

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/hashicorp/yamux"
)

type access struct {
	mu                                         sync.Mutex
	id, clientGrant                            string
	scopes                                     []string
	ticketVersion, accessVersion, grantVersion int64
	verifiedAt, fileExpiresAt, expiresAt       time.Time
	stream                                     net.Conn
	cancel                                     context.CancelFunc
	closed                                     bool
}

func (a *access) close() {
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return
	}
	a.closed = true
	conn, cancel := a.stream, a.cancel
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if conn != nil {
		conn.Close()
	}
}
func (a *access) deadline() time.Time {
	a.mu.Lock()
	defer a.mu.Unlock()
	return minTime(a.expiresAt, a.verifiedAt.Add(180*time.Second))
}
func (a *access) renew(verified, expires time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return
	}
	if !a.fileExpiresAt.IsZero() {
		expires = minTime(expires, a.fileExpiresAt)
	}
	a.verifiedAt, a.expiresAt = verified, expires
	if a.stream != nil {
		a.stream.SetDeadline(minTime(expires, verified.Add(180*time.Second)))
	}
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (s *Service) refreshAccesses(r *route, row sqlc.DeviceClientConnection, restricted bool) {
	s.mu.Lock()
	if restricted {
		r.connectionVersions[row.ID] = connectionVersion{version: row.TicketVersion, accessVersion: row.AccessVersion, expires: row.ExpiresAt}
	}
	all := make([]*access, 0)
	for a := range r.streams {
		if a.id == row.ID {
			all = append(all, a)
		}
	}
	s.mu.Unlock()
	for _, a := range all {
		a.mu.Lock()
		same := slices.Equal(a.scopes, row.Scopes) && a.accessVersion == row.AccessVersion
		a.mu.Unlock()
		if same {
			a.renew(time.Now(), row.ExpiresAt)
		} else {
			s.pushControlForAccess(a)
			a.close()
		}
	}
	s.pushControl(r, map[string]string{"type": "refresh", "connection_id": row.ID})
}

type LeaseRequest struct {
	Type          string            `json:"type"`
	Authorization FileAuthorization `json:"authorization"`
	Nonce         string            `json:"nonce"`
	LeaseSeq      int64             `json:"lease_seq"`
	BootID        string            `json:"boot_id"`
	RequireFresh  bool              `json:"require_fresh"`
}
type leaseResponse struct {
	Signed     string `json:"signed,omitempty"`
	Revocation string `json:"revocation,omitempty"`
	Code       string `json:"code,omitempty"`
}

func (s *Service) revocation(r *route, connection string, version int64) string {
	payload := map[string]any{"type": "monkeyai.access.revocation.v1", "issuer": s.config.PublicURL, "audience": "monkeyai-runtime", "kid": s.kid,
		"server_id": s.config.ServerID, "owner_user_id": r.target.user, "machine_id": r.target.machine, "boot_id": r.hello.BootID, "lease_epoch": r.state.LeaseEpoch}
	if connection != "" {
		payload["connection_id"] = connection
		payload["access_version"] = version
	}
	wire, _ := signWire(s.key, s.kid, payload)
	return wire
}
func (s *Service) pushControl(r *route, value any) bool {
	if r == nil {
		return false
	}
	select {
	case r.controlQueue <- value:
		return true
	default:
		return false
	}
}
func (s *Service) pushControlForAccess(a *access) {
	s.mu.Lock()
	var found *route
	for _, r := range s.routes {
		if _, ok := r.streams[a]; ok {
			found = r
			break
		}
	}
	s.mu.Unlock()
	if found != nil {
		s.pushControl(found, map[string]string{"type": "revocation", "signed": s.revocation(found, a.id, a.accessVersion)})
	}
}
func (s *Service) pushDeviceRevoked(r *route) {
	if r != nil {
		s.pushControl(r, map[string]string{"type": "revocation", "signed": s.revocation(r, "", 0)})
	}
}

func sameAuthorization(a, b FileAuthorization) bool {
	return a.ServerID == b.ServerID && a.OwnerUserID == b.OwnerUserID && a.MachineID == b.MachineID && a.ConnectionID == b.ConnectionID && a.ClientGrantID == b.ClientGrantID && a.GrantVersion == b.GrantVersion && a.AccessVersion == b.AccessVersion && a.LeaseEpoch == b.LeaseEpoch && slices.Equal(a.Scopes, b.Scopes)
}
func (s *Service) authorization(r *route, row sqlc.GetConnectionRow) FileAuthorization {
	return FileAuthorization{ServerID: s.config.ServerID, OwnerUserID: row.UserID, MachineID: row.MachineID, ConnectionID: row.ID, ClientGrantID: row.ClientGrantID, GrantVersion: row.GrantVersion, AccessVersion: row.AccessVersion, LeaseEpoch: r.state.LeaseEpoch, Scopes: row.Scopes}
}
func (s *Service) lease(ctx context.Context, r *route, in LeaseRequest) (leaseResponse, int) {
	auth := in.Authorization
	if in.Type != "access_lease_request" || auth.ServerID != s.config.ServerID || auth.OwnerUserID != r.target.user || auth.MachineID != r.target.machine || auth.LeaseEpoch != r.state.LeaseEpoch || in.BootID != r.hello.BootID || !validUUID(auth.ConnectionID) || !validUUID(auth.ClientGrantID) || auth.GrantVersion <= 0 || auth.GrantVersion > 9007199254740991 || auth.AccessVersion > 9007199254740991 || auth.LeaseEpoch > 9007199254740991 || auth.AccessVersion <= 0 || in.LeaseSeq <= 0 || in.LeaseSeq > 9007199254740991 || in.Nonce == "" || len(in.Nonce) > 128 {
		return leaseResponse{Code: "invalid_tunnel_message"}, 400
	}
	s.mu.Lock()
	if r.leaseSequences == nil {
		r.leaseSequences = make(map[string]int64)
	}
	seq := r.leaseSequences[auth.ConnectionID]
	if in.LeaseSeq <= seq || seq == 0 && len(r.leaseSequences) >= 64 {
		s.mu.Unlock()
		return leaseResponse{Code: "invalid_tunnel_message"}, 400
	}
	r.leaseSequences[auth.ConnectionID] = in.LeaseSeq
	all := make([]*access, 0)
	for a := range r.streams {
		if a.id == auth.ConnectionID {
			all = append(all, a)
		}
	}
	s.mu.Unlock()
	revoked := func() (leaseResponse, int) {
		s.mu.Lock()
		delete(r.leaseSequences, auth.ConnectionID)
		s.mu.Unlock()
		for _, a := range all {
			a.close()
		}
		return leaseResponse{Revocation: s.revocation(r, auth.ConnectionID, auth.AccessVersion)}, 200
	}
	check, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := sqlc.New(s.pool).GetConnection(check, auth.ConnectionID)
	now := time.Now()
	var expires, verified time.Time
	if err == nil {
		if !sameAuthorization(auth, s.authorization(r, row)) || row.UserID != r.target.user || row.MachineID != r.target.machine || row.GrantVersion != r.state.GrantVersion {
			return revoked()
		}
		expires, verified = row.ExpiresAt, now
		s.mu.Lock()
		version := r.connectionVersions[row.ID]
		version.expires = row.ExpiresAt
		r.connectionVersions[row.ID] = version
		s.mu.Unlock()
		for _, a := range all {
			a.mu.Lock()
			same := a.clientGrant == auth.ClientGrantID && a.grantVersion == auth.GrantVersion && a.accessVersion == auth.AccessVersion && slices.Equal(a.scopes, auth.Scopes)
			a.mu.Unlock()
			if same {
				a.renew(now, expires)
			} else {
				a.close()
			}
		}
	} else {
		if isMissing(err) {
			return revoked()
		}
		if in.RequireFresh {
			s.mu.Lock()
			if seq == 0 {
				delete(r.leaseSequences, auth.ConnectionID)
			}
			s.mu.Unlock()
			return leaseResponse{Code: "authorization_state_unavailable"}, 503
		}
		for _, a := range all {
			a.mu.Lock()
			same := !a.closed && a.clientGrant == auth.ClientGrantID && a.grantVersion == auth.GrantVersion && a.accessVersion == auth.AccessVersion && slices.Equal(a.scopes, auth.Scopes)
			if same && (verified.IsZero() || a.verifiedAt.After(verified)) {
				expires, verified = a.expiresAt, a.verifiedAt
			}
			a.mu.Unlock()
		}
		if verified.IsZero() {
			s.mu.Lock()
			if seq == 0 {
				delete(r.leaseSequences, auth.ConnectionID)
			}
			s.mu.Unlock()
			return leaseResponse{Code: "authorization_state_unavailable"}, 503
		}
	}
	ttl := min(60*time.Second, time.Until(minTime(expires, verified.Add(180*time.Second))))
	age := max(0, time.Since(verified).Milliseconds())
	if ttl <= 0 || age >= 180000 {
		return revoked()
	}
	state := "fresh"
	if err != nil {
		state = "grace"
	}
	wire, err := signWire(s.key, s.kid, map[string]any{"type": "monkeyai.access.lease.v1", "issuer": s.config.PublicURL, "audience": "monkeyai-runtime", "kid": s.kid,
		"authorization": auth, "nonce": in.Nonce, "lease_seq": in.LeaseSeq, "boot_id": in.BootID, "ttl_ms": ttl.Milliseconds(), "ticket_remaining_ms": min(int64(900000), max(0, time.Until(expires).Milliseconds())), "auth_age_ms": age, "server_time": now.UTC().Format(time.RFC3339Nano), "verification_state": state})
	if err != nil {
		return leaseResponse{Code: "authorization_state_unavailable"}, 503
	}
	return leaseResponse{Signed: wire}, 200
}

type controlListener struct {
	session *yamux.Session
	slots   chan struct{}
}
type controlConn struct {
	net.Conn
	slots chan struct{}
	once  sync.Once
}

func (c *controlConn) Close() error {
	err := c.Conn.Close()
	c.once.Do(func() { <-c.slots })
	return err
}
func (l *controlListener) Accept() (net.Conn, error) {
	for {
		c, err := l.session.AcceptStream()
		if err != nil {
			return nil, err
		}
		select {
		case l.slots <- struct{}{}:
			return &controlConn{Conn: c, slots: l.slots}, nil
		default:
			c.Close()
		}
	}
}
func (l *controlListener) Close() error   { return l.session.Close() }
func (l *controlListener) Addr() net.Addr { return &net.TCPAddr{} }

func (s *Service) control(ctx context.Context, r *route) {
	s.mu.Lock()
	if s.routes[r.target] != r {
		s.mu.Unlock()
		return
	}
	r.ready = true
	r.seen = time.Now()
	s.mu.Unlock()
	stop := make(chan struct{})
	defer close(stop)
	go s.monitor(r, stop)
	go s.probe(r, stop)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 16 << 10,
		BaseContext: func(net.Listener) context.Context { return ctx }, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { s.controlHTTP(w, req, r) })}
	defer server.Close()
	_ = server.Serve(&controlListener{session: r.control, slots: make(chan struct{}, 16)})
}
func (s *Service) probe(r *route, stop <-chan struct{}) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if _, err := r.control.Ping(); err != nil {
				s.closeRoute(r)
				return
			}
			s.mu.Lock()
			if s.routes[r.target] == r {
				r.seen = time.Now()
			}
			s.mu.Unlock()
		}
	}
}
func (s *Service) controlHTTP(w http.ResponseWriter, req *http.Request, r *route) {
	if req.Host != "relay.internal" {
		http.Error(w, "invalid host", 400)
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case req.Method == "GET" && req.URL.Path == "/_control/status":
		s.mu.Lock()
		online := r.data != nil && !r.data.IsClosed()
		s.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"lease_epoch": r.state.LeaseEpoch, "data_online": online})
	case req.Method == "POST" && req.URL.Path == "/_control/access-lease":
		raw, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxControlMessage))
		var in LeaseRequest
		if err != nil || decodeMessage(raw, &in) != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(leaseResponse{Code: "invalid_tunnel_message"})
			return
		}
		result, status := s.lease(req.Context(), r, in)
		_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(result)
	case req.Method == "GET" && req.URL.Path == "/_control/events":
		s.mu.Lock()
		duplicate := r.eventsActive
		if !duplicate {
			r.eventsActive = true
		}
		s.mu.Unlock()
		if duplicate {
			w.WriteHeader(409)
			return
		}
		defer func() { s.closeRoute(r) }()
		_ = rc.SetReadDeadline(time.Time{})
		w.Header().Set("Content-Type", "application/x-ndjson")
		send := func(value any) bool {
			_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
			raw, err := json.Marshal(value)
			if err != nil || len(raw) > maxControlMessage {
				return false
			}
			if _, err = w.Write(append(raw, '\n')); err != nil {
				return false
			}
			return rc.Flush() == nil
		}
		if !send(map[string]string{"type": "ready"}) {
			return
		}
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case value := <-r.controlQueue:
				if !send(value) {
					return
				}
			case <-ticker.C:
				if !send(map[string]string{"type": "heartbeat"}) {
					return
				}
			case <-req.Context().Done():
				return
			}
		}
	default:
		w.WriteHeader(404)
		json.NewEncoder(w).Encode(map[string]string{"code": "not_found"})
	}
}

func (s *Service) monitor(r *route, stop <-chan struct{}) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	lastHostVerification := time.Now()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.mu.Lock()
			for id, v := range r.connectionVersions {
				if !time.Now().Before(v.expires) {
					delete(r.connectionVersions, id)
					delete(r.leaseSequences, id)
				}
			}
			active, seen := s.routes[r.target] == r, r.seen
			all := make([]*access, 0, len(r.streams))
			for a := range r.streams {
				all = append(all, a)
			}
			s.mu.Unlock()
			if !active || time.Since(seen) >= 45*time.Second {
				s.closeRoute(r)
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			valid, err := s.identity.VerifyGrant(ctx, r.principal)
			state, stateErr := s.devices.State(ctx, r.target.user, r.target.machine)
			cancel()
			if err == nil && stateErr == nil {
				if !valid || state.GrantVersion != r.state.GrantVersion || state.RemoteAccessState != "enabled" {
					s.pushDeviceRevoked(r)
					s.closeRoute(r)
					return
				}
				lastHostVerification = time.Now()
			} else if time.Since(lastHostVerification) >= 180*time.Second {
				s.closeRoute(r)
				return
			}
			ids := make([]string, 0, 8)
			for _, a := range all {
				if a.id != "" && !slices.Contains(ids, a.id) {
					ids = append(ids, a.id)
				}
			}
			check, done := context.WithTimeout(context.Background(), 3*time.Second)
			rows, verifyErr := sqlc.New(s.pool).GetConnections(check, ids)
			done()
			states := make(map[string]sqlc.GetConnectionsRow, len(rows))
			for _, row := range rows {
				states[row.ID] = row
			}
			for _, a := range all {
				if a.id == "" && err == nil && stateErr == nil {
					a.mu.Lock()
					expiry := a.expiresAt
					a.mu.Unlock()
					a.renew(lastHostVerification, expiry)
				}
				if !time.Now().Before(a.deadline()) {
					a.close()
					continue
				}
				if a.id == "" || verifyErr != nil {
					continue
				}
				row, found := states[a.id]
				a.mu.Lock()
				changed := !found || !slices.Equal(row.Scopes, a.scopes) || row.GrantVersion != a.grantVersion || row.AccessVersion != a.accessVersion
				a.mu.Unlock()
				if changed {
					s.pushControlForAccess(a)
					a.close()
				} else {
					a.renew(time.Now(), row.ExpiresAt)
				}
			}
		}
	}
}
func streamSession(r *route, data bool) (*yamux.Session, chan struct{}) {
	if data {
		return r.data, r.slotsData
	}
	return r.control, r.slotsControl
}
