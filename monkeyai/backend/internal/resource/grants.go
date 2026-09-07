package resource

import (
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func (s *Store) RegisterGrants(r chi.Router, resources map[string]*CRUD) {
	r.Get("/resources/{type}/{id}/grants", func(w http.ResponseWriter, r *http.Request) {
		c := resources[chi.URLParam(r, "type")]
		if c == nil {
			Fail(w, NotFound)
			return
		}
		o, err := c.Get(r.Context(), s.Pool, chi.URLParam(r, "id"))
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, Object{"grants": o["grants"], "revision": o["revision"]})
	})
	r.Put("/resources/{type}/{id}/grants", func(w http.ResponseWriter, r *http.Request) {
		c := resources[chi.URLParam(r, "type")]
		if c == nil {
			Fail(w, NotFound)
			return
		}
		var in Object
		if err := Decode(w, r, &in); err != nil {
			Fail(w, err)
			return
		}
		ctx := r.Context()
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			Fail(w, err)
			return
		}
		defer tx.Rollback(ctx)
		id := chi.URLParam(r, "id")
		o, err := Row(ctx, tx, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id)
		if err != nil {
			Fail(w, err)
			return
		}
		if o.String("ownership_type") == "user" {
			Fail(w, Invalid("个人资源的分享范围由所有者管理"))
			return
		}
		if r.Header.Get("If-Match") != fmt.Sprintf(`"%v"`, o["revision"]) {
			Fail(w, Conflict)
			return
		}
		u, _ := identity.UserFromContext(ctx)
		if err = SaveGrants(ctx, tx, c.Def.Kind, id, u.ID, in["grants"], false); err == nil {
			_, err = tx.Exec(ctx, `UPDATE `+c.Def.Table+` SET updated_at=now(),revision=revision+1 WHERE id=$1`, id)
		}
		if err == nil {
			err = Audit(ctx, tx, u.ID, c.Def.Kind, id, "grants")
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			Fail(w, err)
			return
		}
		o, err = c.Get(ctx, s.Pool, id)
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, Object{"grants": o["grants"], "revision": o["revision"]})
	})
}
