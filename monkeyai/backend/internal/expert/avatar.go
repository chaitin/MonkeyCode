package expert

import (
	"io"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) serveAvatar(w http.ResponseWriter, req *http.Request, admin bool) {
	ctx := req.Context()
	id := chi.URLParam(req, "id")
	expert, err := resource.DecodeObject(sqlc.New(s.Store.Pool).GetResource(ctx, id))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if !admin {
		user, ok := identity.UserFromContext(ctx)
		if !ok {
			resource.Fail(w, resource.NotFound)
			return
		}
		allowed, err := resource.Accessible(ctx, s.Store.Pool, "expert", expert, user.ID)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if !allowed {
			resource.Fail(w, resource.NotFound)
			return
		}
	}
	key := expert.String("avatar_s3_key")
	if key == "" {
		resource.Fail(w, resource.NotFound)
		return
	}
	body, err := s.storage.Get(ctx, key)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, 2<<20))
	if err != nil || len(data) >= 2<<20 {
		resource.Fail(w, &resource.Error{Status: 502, Code: "storage_corrupted", Message: "专家头像读取失败"})
		return
	}
	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Write(data)
}
