package group

import (
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/groups", func(w http.ResponseWriter, r *http.Request) {
		groups, err := s.List(r.Context())
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, http.StatusOK, map[string]any{"groups": groups})
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var in Input
		if err := resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		id := chi.URLParam(r, "groupID")
		group, err := s.Save(r.Context(), user.ID, id, in)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		status := http.StatusOK
		if id == "" {
			status = http.StatusCreated
		}
		resource.JSON(w, status, group)
	}
	router.Post("/groups", save)
	router.Patch("/groups/{groupID}", save)
	router.Put("/groups/{groupID}/members", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			MemberIDs []string `json:"member_ids"`
		}
		if err := resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		group, err := s.SetMembers(r.Context(), user.ID, chi.URLParam(r, "groupID"), in.MemberIDs)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, http.StatusOK, group)
	})
	router.Delete("/groups/{groupID}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if err := s.Delete(r.Context(), user.ID, chi.URLParam(r, "groupID")); err != nil {
			resource.Fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
