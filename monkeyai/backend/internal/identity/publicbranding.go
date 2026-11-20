package identity

import (
	"context"
	"encoding/json"
)

type PublicBrandingReader interface {
	PublicValue(context.Context) (json.RawMessage, error)
}

func (s *Service) WithBranding(reader PublicBrandingReader) *Service {
	s.brandingProvider = reader
	return s
}
