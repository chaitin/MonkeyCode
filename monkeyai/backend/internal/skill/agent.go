package skill

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(r chi.Router) {
	s.CRUD.RegisterAgent(r)
	r.Post("/skills", func(w http.ResponseWriter, r *http.Request) { s.upload(w, r, true) })
	r.Put("/skills/{id}/package", func(w http.ResponseWriter, r *http.Request) { s.upload(w, r, true) })
	r.Get("/skills/{id}/manifest", func(w http.ResponseWriter, r *http.Request) { s.manifest(w, r, true) })
}
