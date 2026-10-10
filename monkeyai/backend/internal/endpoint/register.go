package endpoint

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
)

type Details struct {
	ClientType      *string `json:"client_type"`
	ClientName      *string `json:"client_name"`
	Channel         *string `json:"channel"`
	Locale          *string `json:"locale"`
	SystemLocale    *string `json:"system_locale"`
	Timezone        *string `json:"timezone"`
	RuntimeVersion  *string `json:"runtime_version"`
	EngineVersion   *string `json:"engine_version"`
	ElectronVersion *string `json:"electron_version"`
}

type Registration struct {
	Profile
	Details
	ProtocolVersion *int32 `json:"protocol_version"`
}

type Registrar interface {
	RegisterDevice(context.Context, string, string, Registration, int) (Endpoint, error)
}

func registration(data []byte) (Registration, error) {
	var r Registration
	fields, err := object(data)
	if err != nil {
		return r, errInvalid
	}
	allowed := []string{
		"device_name", "platform", "os_version", "arch", "client_version", "protocol_version",
		"client_type", "client_name", "channel", "locale", "system_locale", "timezone",
		"runtime_version", "engine_version", "electron_version",
	}
	for key := range fields {
		if !slices.Contains(allowed, key) {
			return r, errInvalid
		}
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return r, errInvalid
	}
	if !text(r.DeviceName, 128) || !text(r.OSVersion, 64) || !text(r.Arch, 32) || !text(r.ClientVersion, 64) ||
		!slices.Contains([]string{"macos", "windows", "linux", "ios", "android", "web"}, r.Platform) ||
		(r.ProtocolVersion != nil && *r.ProtocolVersion <= 0) {
		return r, errInvalid
	}
	for _, field := range []struct {
		value *string
		limit int
	}{
		{r.ClientType, 32}, {r.ClientName, 128}, {r.Channel, 64}, {r.Locale, 64},
		{r.SystemLocale, 64}, {r.Timezone, 64}, {r.RuntimeVersion, 64},
		{r.EngineVersion, 64}, {r.ElectronVersion, 64},
	} {
		if field.value != nil && !text(*field.value, field.limit) {
			return r, errInvalid
		}
	}
	return r, nil
}

func (s *Service) register(w http.ResponseWriter, req *http.Request) {
	machine := chi.URLParam(req, "machine")
	if !validID(machine) {
		failure(w, 400, "invalid_request")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, req.Body, 4096))
	if err != nil {
		failure(w, 400, "invalid_request")
		return
	}
	r, err := registration(data)
	if err != nil {
		failure(w, 400, "invalid_request")
		return
	}
	s.manage(w, req, func(ctx context.Context, user string, u *userState) (any, error) {
		store, ok := s.store.(Registrar)
		if !ok {
			return nil, fault{"service_unavailable"}
		}
		e, err := store.RegisterDevice(ctx, user, machine, r, 20)
		if err != nil {
			return nil, err
		}
		u.endpoints[machine] = e
		s.broadcast(user, u)
		return s.view(u, e), nil
	})
}
