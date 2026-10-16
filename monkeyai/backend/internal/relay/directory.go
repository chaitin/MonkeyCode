package relay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type directoryRoute struct {
	principal           identity.Principal
	hello               Hello
	seen                time.Time
	status, health      string
	grantVersion, epoch int64
}

func (s *Service) directoryRoutes(user string) map[string]directoryRoute {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]directoryRoute)
	now := time.Now()
	for key, r := range s.routes {
		if key.user == user && r.ready && now.Sub(r.seen) < 45*time.Second && r.control != nil && !r.control.IsClosed() {
			out[key.machine] = directoryRoute{principal: r.principal, hello: r.hello, seen: r.seen, status: r.runtimeStatus, health: r.engineHealth, grantVersion: r.state.GrantVersion, epoch: r.state.LeaseEpoch}
		}
	}
	return out
}
func (s *Service) RuntimeStatus(_ context.Context, user, machine string) (string, string, int64, error) {
	r := s.current(target{user, machine})
	if r == nil {
		return "offline", "", 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return r.runtimeStatus, r.hello.BootID, r.state.LeaseEpoch, nil
}
func (s *Service) Directory() http.Handler {
	return identity.RequireScope("device:connect")(http.HandlerFunc(s.directory))
}
func (s *Service) directory(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, _ := identity.PrincipalFromContext(r.Context())
	page, size := 1, 100
	var err error
	if value := r.URL.Query().Get("page"); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil {
			failure(w, 400, "invalid_request")
			return
		}
	}
	if value := r.URL.Query().Get("page_size"); value != "" {
		size, err = strconv.Atoi(value)
		if err != nil {
			failure(w, 400, "invalid_request")
			return
		}
	}
	capability := r.URL.Query().Get("capability")
	if page < 1 || page > 1000000 || size < 1 || size > 100 || capability != "" && capability != "execute" {
		failure(w, 400, "invalid_request")
		return
	}
	rows, err := s.devices.Snapshot(ctx, p.UserID, capability == "execute")
	if err != nil {
		failure(w, 503, "authorization_state_unavailable")
		return
	}
	routes := s.directoryRoutes(p.UserID)
	// 对完整筛选结果求版本，再分页，避免只对某页或另一次路由读取求版本。
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		status := "offline"
		current, online := routes[row.MachineID]
		online = online && row.RemoteAccessState == "enabled" && row.GrantVersion == current.grantVersion && row.LeaseEpoch == current.epoch
		if row.RemoteAccessState == "revoked" {
			status = "revoked"
		} else if online {
			valid, err := s.identity.VerifyGrant(ctx, current.principal)
			if err != nil {
				failure(w, 503, "authorization_state_unavailable")
				return
			}
			if valid {
				status = current.status
			} else {
				status = "auth_required"
			}
		}
		protocols := row.Protocols
		if protocols == nil {
			protocols = map[string][]int{}
		}
		item := map[string]any{"machine_id": row.MachineID, "display_name": row.DisplayName, "platform": row.Platform, "arch": row.Arch,
			"execution_supported": len(row.PublicKey) == 32, "remote_access_state": row.RemoteAccessState, "deployment_mode": row.DeploymentMode, "status": status,
			"last_seen_at": row.LastSeenAt, "runtime_version": row.RuntimeVersion, "engine_version": row.EngineVersion, "protocols": protocols, "capability_summary": map[string]bool{}, "engine_health": "unknown"}
		if online {
			item["engine_health"] = current.health
			item["last_seen_at"] = current.seen.UTC()
			item["boot_id"] = current.hello.BootID
			item["protocols"] = current.hello.Protocols
			item["runtime_version"] = current.hello.RuntimeVersion
			item["engine_version"] = current.hello.EngineVersion
		}
		out = append(out, item)
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		failure(w, 503, "authorization_state_unavailable")
		return
	}
	digest := sha256.Sum256(encoded)
	start := min((page-1)*size, len(out))
	end := min(start+size, len(out))
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(w, 200, map[string]any{"items": out[start:end], "total": len(out), "page": page, "page_size": size, "version": hex.EncodeToString(digest[:])})
}
