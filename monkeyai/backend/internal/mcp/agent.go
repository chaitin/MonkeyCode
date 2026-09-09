package mcp

import (
	"context"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) listProviders(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	allowed, err := resource.CanUseSystem(r.Context(), s.Store.Pool, u.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	items, err := resource.DecodeObjects(sqlc.New(s.Store.Pool).ListUserProviders(r.Context(), sqlc.ListUserProvidersParams{UserID: u.ID, SystemAccess: allowed}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	for _, p := range items {
		userProvider(p)
	}
	resource.JSON(w, http.StatusOK, resource.Object{"items": items})
}

func (s *Service) getProvider(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	p, err := s.userProvider(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	userProvider(p)
	resource.ETag(w, p)
	resource.JSON(w, http.StatusOK, p)
}

func userProvider(p resource.Object) {
	delete(p, "identifier")
	p["icon_path"] = ""
	if key := p.String("icon_s3_key"); key != "" {
		p["icon_path"] = "/api/v1/connector-providers/" + p.String("id") + "/icon?v=" + resource.Hash(key)
	}
	delete(p, "icon_s3_key")
	delete(p, "oauth_client_secret")
}

func userIcon(o resource.Object) {
	path := o.String("icon_path")
	if id := o.String("provider_id"); id != "" {
		o["icon_path"] = strings.Replace(path, "/api/admin/v1/connector-providers/"+id, "/api/v1/connectors/"+o.String("id"), 1)
	} else {
		o["icon_path"] = strings.Replace(path, "/api/admin/v1/", "/api/v1/", 1)
	}
}

func (s *Service) userProvider(ctx context.Context, q resource.Queryer, id, user string) (resource.Object, error) {
	allowed, err := resource.CanUseSystem(ctx, q, user)
	if err != nil {
		return nil, err
	}
	return resource.DecodeObject(sqlc.New(q).GetUserProvider(ctx, sqlc.GetUserProviderParams{ID: id, UserID: user, SystemAccess: allowed}))
}
