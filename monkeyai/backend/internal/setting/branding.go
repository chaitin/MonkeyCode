package setting

import (
	"context"
	"encoding/json"
)

type BrandingReader interface {
	Value(context.Context) (json.RawMessage, error)
	AdminValue(context.Context, json.RawMessage) (json.RawMessage, error)
}

var defaultBranding = json.RawMessage(`{"workspace_name":"Monkey AI","product_name":"MonkeyAI","logo_url":""}`)

func (s *Service) WithBranding(reader BrandingReader) *Service { s.branding = reader; return s }

func (s *Service) brandingValue(ctx context.Context) (json.RawMessage, error) {
	if s.branding == nil {
		return append(json.RawMessage(nil), defaultBranding...), nil
	}
	return s.branding.Value(ctx)
}
func (s *Service) adminRecord(ctx context.Context, record Record) (Record, error) {
	var err error
	if record.Key == "branding" {
		if s.branding == nil {
			record.Value = append(json.RawMessage(nil), defaultBranding...)
		} else {
			record.Value, err = s.branding.AdminValue(ctx, record.Value)
		}
	} else {
		record.Value, err = redact(record.Key, record.Value)
	}
	return record, err
}
