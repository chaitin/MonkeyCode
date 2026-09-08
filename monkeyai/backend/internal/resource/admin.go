package resource

import (
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"

	"github.com/go-chi/chi/v5"
)

func (s *Store) RegisterAdmin(r chi.Router) {
	r.Get("/resources/authorization-subjects", func(w http.ResponseWriter, r *http.Request) {
		groups, err := DecodeObjects(sqlc.New(s.Pool).ListGroups(r.Context()))
		if err != nil {
			Fail(w, err)
			return
		}
		users, err := DecodeObjects(sqlc.New(s.Pool).ListUsers(r.Context()))
		if err != nil {
			Fail(w, err)
			return
		}
		JSON(w, 200, Object{"groups": groups, "users": users})
	})
	r.Get("/tags", func(w http.ResponseWriter, r *http.Request) {
		items, err := DecodeObjects(sqlc.New(s.Pool).ListTags(r.Context()))
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
			out, err = DecodeObject(sqlc.New(tx).CreateTag(r.Context(), sqlc.CreateTagParams{Name: name, CreatedByUserID: u.ID}))
		} else {
			out, err = DecodeObject(sqlc.New(tx).UpdateTag(r.Context(), sqlc.UpdateTagParams{ID: id, Name: name}))
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
		o, err := DecodeObject(sqlc.New(tx).DeleteTag(r.Context(), id))
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
