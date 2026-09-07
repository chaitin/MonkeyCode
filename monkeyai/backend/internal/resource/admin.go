package resource

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"net/http"
	"strings"
)

func (s *Store) RegisterAdmin(r chi.Router) {
	r.Get("/resources/authorization-subjects", func(w http.ResponseWriter, r *http.Request) {
		groups, err := Rows(r.Context(), s.Pool, `SELECT jsonb_build_object('id',id,'parent_id',parent_id,'name',name) FROM groups WHERE deleted_at IS NULL ORDER BY name,id`)
		if err != nil {
			Fail(w, err)
			return
		}
		users, err := Rows(r.Context(), s.Pool, `SELECT jsonb_build_object('id',id,'name',name,'email',email) FROM users WHERE deleted_at IS NULL AND status='active' ORDER BY name,id`)
		if err != nil {
			Fail(w, err)
			return
		}
		JSON(w, 200, Object{"groups": groups, "users": users})
	})
	r.Get("/tags", func(w http.ResponseWriter, r *http.Request) {
		items, err := Rows(r.Context(), s.Pool, `SELECT jsonb_build_object('id',id,'name',name) FROM tags WHERE deleted_at IS NULL ORDER BY lower(name),id`)
		if err != nil {
			Fail(w, err)
			return
		}
		JSON(w, 200, Object{"items": items})
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var in Object
		if err := Decode(w, r, &in); err != nil {
			Fail(w, err)
			return
		}
		name := strings.TrimSpace(in.String("name"))
		if name == "" || len(name) > 100 {
			Fail(w, Invalid("标签名称无效"))
			return
		}
		u, _ := identity.UserFromContext(r.Context())
		tx, err := s.Pool.Begin(r.Context())
		if err != nil {
			Fail(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		id := chi.URLParam(r, "id")
		var out Object
		if id == "" {
			out, err = Row(r.Context(), tx, `INSERT INTO tags(name,created_by_user_id) VALUES($1,$2) RETURNING jsonb_build_object('id',id,'name',name)`, name, u.ID)
		} else {
			out, err = Row(r.Context(), tx, `UPDATE tags SET name=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING jsonb_build_object('id',id,'name',name)`, id, name)
		}
		if err == nil {
			err = Audit(r.Context(), tx, u.ID, "tag", out.String("id"), "save")
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			Fail(w, err)
			return
		}
		JSON(w, 200, out)
	}
	r.Post("/tags", save)
	r.Put("/tags/{id}", save)
	r.Delete("/tags/{id}", func(w http.ResponseWriter, r *http.Request) {
		tx, err := s.Pool.Begin(r.Context())
		if err != nil {
			Fail(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		id := chi.URLParam(r, "id")
		o, err := Row(r.Context(), tx, `UPDATE tags SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING jsonb_build_object('id',id)`, id)
		u, _ := identity.UserFromContext(r.Context())
		if err == nil {
			err = Audit(r.Context(), tx, u.ID, "tag", o.String("id"), "delete")
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			Fail(w, err)
			return
		}
		w.WriteHeader(204)
	})
}
