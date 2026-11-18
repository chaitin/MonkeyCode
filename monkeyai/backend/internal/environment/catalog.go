package environment

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type HostOption struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Architecture string        `json:"architecture"`
	Billing      BillingConfig `json:"billing"`
	Available    bool          `json:"available"`
	Reason       string        `json:"reason,omitempty"`
}

func (s *Service) accessibleHosts(w http.ResponseWriter, r *http.Request) {
	page, size, err := resource.PageParamsWithLimit(r, 100)
	if err != nil {
		fail(w, r, err)
		return
	}
	user := owner(r, false)
	q := sqlc.New(s.pool)
	candidates, err := q.AccessibleHostCandidates(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	items := make([]HostOption, 0)
	for _, h := range candidates {
		allowed, err := resource.Allowed(r.Context(), s.pool, "host", h.ID, *user)
		if err != nil {
			fail(w, r, err)
			return
		}
		if !allowed {
			continue
		}
		pricing, err := decodeBilling(h.Billing)
		if err != nil {
			fail(w, r, err)
			return
		}
		option := HostOption{ID: h.ID, Name: h.Name, Architecture: h.Architecture, Billing: pricing}
		var report struct {
			Ready bool `json:"prerequisites_met"`
		}
		_ = json.Unmarshal(h.Report, &report)
		option.Available = h.Status == "active" && h.Enabled && report.Ready && h.LastSeenAt != nil && h.EnvironmentSyncedAt != nil && time.Since(*h.LastSeenAt) <= 90*time.Second && time.Since(*h.EnvironmentSyncedAt) <= 90*time.Second
		if !option.Available {
			option.Reason = "host_unavailable"
		}
		if _, _, err := s.defaultImage(r.Context(), h.Architecture); err != nil {
			option.Available = false
			option.Reason = "image_unavailable"
		}
		items = append(items, option)
	}
	start := min((page-1)*size, len(items))
	end := min(start+size, len(items))
	respond(w, r, 200, map[string]any{"items": items[start:end], "page": page, "page_size": size})
}
