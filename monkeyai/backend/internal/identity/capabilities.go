package identity

import (
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/license"
)

func (s *Service) WithLicense(reader license.Reader) *Service {
	s.license = reader
	return s
}

func (s *Service) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(r.Context(), w, http.StatusOK, license.Read(r.Context(), s.license))
}
