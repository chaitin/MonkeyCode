package relay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var businessScopes = []string{"session:read", "session:control", "files:read", "files:write", "resources:manage"}

type ConnectionRequest struct {
	ConnectionID       string           `json:"connection_id,omitempty"`
	Scopes             *[]string        `json:"scopes,omitempty"`
	SupportedProtocols map[string][]int `json:"supported_protocols,omitempty"`
}

type ConnectionResponse struct {
	ConnectionID  string          `json:"connection_id"`
	MachineID     string          `json:"machine_id"`
	HTTPBase      string          `json:"http_base"`
	Ticket        string          `json:"ticket"`
	TicketVersion int64           `json:"ticket_version"`
	ExpiresAt     time.Time       `json:"expires_at"`
	ExpiresIn     int64           `json:"expires_in"`
	ServerTime    time.Time       `json:"server_time"`
	Scopes        []string        `json:"scopes"`
	Protocol      json.RawMessage `json:"protocol"`
}

func (s *Service) connections(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	w.Header().Set("Cache-Control", "no-store")
	p, _ := identity.PrincipalFromContext(r.Context())
	if !s.allow(p.GrantID) {
		w.Header().Set("Retry-After", "1")
		failure(r.Context(), w, 429, "relay_overloaded")
		return
	}
	machine := chi.URLParam(r, "machine")
	if !validUUID(machine) {
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	var in ConnectionRequest
	data, err := readBody(w, r, maxControlMessage)
	if err != nil || decodeMessage(data, &in) != nil {
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	state, err := s.devices.State(r.Context(), p.UserID, machine)
	if err != nil {
		fail(r.Context(), w, err)
		return
	}
	key := target{p.UserID, machine}
	route := s.current(key)
	if route == nil {
		failure(r.Context(), w, 503, "device_offline")
		return
	}
	s.mu.Lock()
	runtimeStatus := route.runtimeStatus
	s.mu.Unlock()
	if runtimeStatus != "online" {
		failure(r.Context(), w, 503, "device_draining")
		return
	}
	if state.RemoteAccessState != "enabled" {
		failure(r.Context(), w, 403, "device_revoked")
		return
	}
	ticket, err := randomSecret()
	if err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	defer tx.Rollback(context.WithoutCancel(r.Context()))
	q := sqlc.New(tx)
	if _, err = q.LockUser(r.Context(), p.UserID); err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	valid, err := s.identity.AuthorizeDevice(r.Context(), tx, p, "device:connect")
	if err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	if !valid {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	state, err = s.devices.ReadState(r.Context(), tx, p.UserID, machine)
	if err != nil {
		fail(r.Context(), w, err)
		return
	}
	if state.RemoteAccessState != "enabled" || state.GrantVersion != route.state.GrantVersion || state.LeaseEpoch != route.state.LeaseEpoch || s.current(key) != route {
		failure(r.Context(), w, 503, "device_offline")
		return
	}
	hostValid, hostErr := s.identity.AuthorizeDevice(r.Context(), tx, route.principal, "device:publish")
	if hostErr != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	if !hostValid {
		failure(r.Context(), w, 403, "device_revoked")
		return
	}
	var row sqlc.DeviceClientConnection
	var protocol []byte
	scopes := []string{}
	expiry := time.Now().UTC().Add(15 * time.Minute)
	if in.ConnectionID != "" {
		if !validUUID(in.ConnectionID) {
			failure(r.Context(), w, 400, "invalid_request")
			return
		}
		row, err = q.LockConnection(r.Context(), sqlc.LockConnectionParams{ID: in.ConnectionID, UserID: p.UserID, ClientGrantID: p.GrantID})
		if err != nil || row.MachineID != machine || row.RevokedAt != nil || !time.Now().Before(row.ExpiresAt) || row.GrantVersion != state.GrantVersion {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				failure(r.Context(), w, 503, "authorization_state_unavailable")
			} else {
				failure(r.Context(), w, 401, "connection_expired")
			}
			return
		}
		scopes = slices.Clone(row.Scopes)
		protocol = row.Protocol
		if in.Scopes != nil {
			for _, scope := range *in.Scopes {
				if !slices.Contains(scopes, scope) {
					failure(r.Context(), w, 400, "invalid_scope")
					return
				}
			}
			scopes = slices.Clone(*in.Scopes)
		}
	} else {
		if in.Scopes == nil {
			for _, scope := range businessScopes {
				if p.Has(scope) {
					scopes = append(scopes, scope)
				}
			}
		} else {
			scopes = slices.Clone(*in.Scopes)
		}
		if len(scopes) == 0 {
			failure(r.Context(), w, 400, "invalid_scope")
			return
		}
		count, err := q.CountConnections(r.Context(), sqlc.CountConnectionsParams{UserID: p.UserID, MachineID: machine, GrantVersion: state.GrantVersion})
		if err != nil {
			failure(r.Context(), w, 503, "authorization_state_unavailable")
			return
		}
		if count >= 8 {
			w.Header().Set("Retry-After", "30")
			failure(r.Context(), w, 429, "device_connection_limit")
			return
		}
	}
	for _, scope := range scopes {
		if !slices.Contains(businessScopes, scope) || !p.Has(scope) {
			failure(r.Context(), w, 403, "permission_denied")
			return
		}
	}
	slices.Sort(scopes)
	scopes = slices.Compact(scopes)
	if len(in.SupportedProtocols) > 0 || in.ConnectionID == "" {
		negotiated := make(map[string]int)
		for _, name := range []string{"acp", "runtime_api"} {
			if !slices.Contains(in.SupportedProtocols[name], 1) || !slices.Contains(route.hello.Protocols[name], 1) {
				failure(r.Context(), w, 409, "upgrade_required")
				return
			}
			negotiated[name] = 1
		}
		protocol, _ = json.Marshal(negotiated)
		if in.ConnectionID != "" && !sameProtocol(row.Protocol, protocol) {
			failure(r.Context(), w, 409, "upgrade_required")
			return
		}
	}
	restricted := in.ConnectionID != "" && !slices.Equal(row.Scopes, scopes)
	if in.ConnectionID == "" {
		row, err = q.CreateConnection(r.Context(), sqlc.CreateConnectionParams{UserID: p.UserID, MachineID: machine, ClientGrantID: p.GrantID, GrantVersion: state.GrantVersion, Scopes: scopes, Protocol: protocol, TicketHash: secretHash(ticket), ExpiresAt: expiry})
	} else {
		row, err = q.RotateTicket(r.Context(), sqlc.RotateTicketParams{ID: row.ID, TicketHash: secretHash(ticket), Scopes: scopes, ExpiresAt: expiry})
	}
	if err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		failure(r.Context(), w, 503, "authorization_state_unavailable")
		return
	}
	if in.ConnectionID != "" {
		s.refreshAccesses(route, row, restricted)
	}
	now := time.Now().UTC()
	resource.JSON(r.Context(), w, 200, ConnectionResponse{ConnectionID: row.ID, MachineID: machine, HTTPBase: s.config.PublicURL + "/api/v1/endpoints/" + machine + "/proxy/", Ticket: ticket, TicketVersion: row.TicketVersion, ExpiresAt: row.ExpiresAt, ExpiresIn: max(0, int64(row.ExpiresAt.Sub(now).Seconds())), ServerTime: now, Scopes: row.Scopes, Protocol: row.Protocol})
}

func sameProtocol(a, b []byte) bool {
	var first, second map[string]int
	return json.Unmarshal(a, &first) == nil && json.Unmarshal(b, &second) == nil && first["acp"] == second["acp"] && first["runtime_api"] == second["runtime_api"]
}
