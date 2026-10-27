package relay

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
)

type FileAuthorization struct {
	ServerID      string   `json:"server_id"`
	OwnerUserID   string   `json:"owner_user_id"`
	MachineID     string   `json:"machine_id"`
	ConnectionID  string   `json:"connection_id"`
	ClientGrantID string   `json:"client_grant_id"`
	GrantVersion  int64    `json:"grant_version"`
	AccessVersion int64    `json:"access_version"`
	LeaseEpoch    int64    `json:"lease_epoch"`
	Scopes        []string `json:"scopes"`
}

type FileGrantV1 struct {
	Type          string            `json:"type"`
	Version       int               `json:"version"`
	KeyID         string            `json:"key_id"`
	Authorization FileAuthorization `json:"authorization"`
	SessionID     string            `json:"session_id"`
	Path          string            `json:"path"`
	Purpose       string            `json:"purpose"`
	IssuedAt      int64             `json:"issued_at"`
	ExpiresAt     int64             `json:"expires_at"`
}

func FileGrantV1Bytes(grant FileGrantV1) ([]byte, error) {
	data, err := json.Marshal(grant)
	return append([]byte("monkeyai.file-grant.v1\n"), data...), err
}

type FileGrant struct {
	ArtifactID    string    `json:"artifact_id,omitempty"`
	PreviewOrigin string    `json:"preview_origin,omitempty"`
	Version       int       `json:"version"`
	ServerID      string    `json:"server_id"`
	OwnerUserID   string    `json:"owner_user_id"`
	MachineID     string    `json:"machine_id"`
	SessionID     string    `json:"session_id"`
	Path          string    `json:"path"`
	Scope         string    `json:"scope"`
	KeyID         string    `json:"key_id"`
	GrantVersion  int64     `json:"grant_version"`
	IssuedAt      time.Time `json:"issued_at"`
	ExpiresAt     time.Time `json:"expires_at"`
	ConnectionID  string    `json:"-"`
	ClientGrantID string    `json:"-"`
	AccessVersion int64     `json:"-"`
	LeaseEpoch    int64     `json:"-"`
	Scopes        []string  `json:"-"`
}

func FileGrantBytes(grant FileGrant) ([]byte, error) {
	data, err := json.Marshal(grant)
	return append([]byte("monkeyai:file-grant:v1\n"), data...), err
}

func (s *Service) verifyFileV1(ctx context.Context, machine, raw, requested string) (FileGrant, *route, error) {
	denied := &resource.Error{Status: 403, Code: "permission_denied", Message: "文件授权无效"}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 || parts[0] != "fg1" || len(raw) > 12<<10 {
		return FileGrant{}, nil, denied
	}
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	var in FileGrantV1
	if err != nil || len(payload) > 8<<10 || decodeMessage(payload, &in) != nil || in.Type != "monkeyai.file-grant.v1" || in.Version != 1 || in.KeyID == "" || in.SessionID == "" || in.Path == "" || (in.Purpose != "resource" && in.Purpose != "download") {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "relay", "operation", "verifyFileV1", "error", err)
		}
		return FileGrant{}, nil, denied
	}
	if !safePath("/"+in.Path) || requested != "/"+in.Path {
		return FileGrant{}, nil, denied
	}
	auth := in.Authorization
	if auth.ServerID != s.config.ServerID || auth.MachineID != machine || !validUUID(auth.OwnerUserID) || !validUUID(auth.ConnectionID) || !validUUID(auth.ClientGrantID) || auth.GrantVersion <= 0 || auth.AccessVersion <= 0 || auth.LeaseEpoch <= 0 {
		return FileGrant{}, nil, denied
	}
	scopes := slices.Clone(auth.Scopes)
	if len(scopes) == 0 || !slices.Contains(scopes, "files:read") {
		return FileGrant{}, nil, denied
	}
	slices.Sort(scopes)
	if !slices.Equal(scopes, auth.Scopes) || len(slices.Compact(scopes)) != len(auth.Scopes) {
		return FileGrant{}, nil, denied
	}
	state, err := s.devices.State(ctx, auth.OwnerUserID, machine)
	if err != nil {
		var fault *resource.Error
		if errors.As(err, &fault) {
			return FileGrant{}, nil, denied
		}
		return FileGrant{}, nil, err
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	message, encodeErr := FileGrantV1Bytes(in)
	if encodeErr != nil {
		return FileGrant{}, nil, encodeErr
	}
	if err != nil || len(state.PublicKey) != ed25519.PublicKeySize || in.KeyID != state.KeyID || !ed25519.Verify(state.PublicKey, message, signature) {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "relay", "operation", "verifyFileV1", "error", err)
		}
		return FileGrant{}, nil, denied
	}
	now := time.Now()
	issued, expires := time.UnixMilli(in.IssuedAt), time.UnixMilli(in.ExpiresAt)
	if in.IssuedAt < 0 || in.ExpiresAt > 9007199254740991 || in.ExpiresAt <= in.IssuedAt || expires.Sub(issued) > 5*time.Minute || issued.After(now.Add(5*time.Second)) || !now.Before(expires) || state.RemoteAccessState != "enabled" || state.GrantVersion != auth.GrantVersion || state.LeaseEpoch != auth.LeaseEpoch {
		return FileGrant{}, nil, denied
	}
	row, err := sqlc.New(s.pool).GetConnection(ctx, auth.ConnectionID)
	if err != nil {
		if isMissing(err) {
			return FileGrant{}, nil, denied
		}
		return FileGrant{}, nil, err
	}
	if row.UserID != auth.OwnerUserID || row.MachineID != machine || row.ClientGrantID != auth.ClientGrantID || row.GrantVersion != auth.GrantVersion || row.AccessVersion != auth.AccessVersion || !slices.Equal(row.Scopes, auth.Scopes) {
		return FileGrant{}, nil, denied
	}
	current := s.current(target{auth.OwnerUserID, machine})
	if current == nil {
		return FileGrant{}, nil, &resource.Error{Status: 503, Code: "device_offline", Message: "目标执行端离线"}
	}
	valid, err := s.identity.VerifyGrant(ctx, current.principal)
	if err != nil {
		return FileGrant{}, nil, err
	}
	if !valid || current.state.LeaseEpoch != auth.LeaseEpoch {
		return FileGrant{}, nil, denied
	}
	return FileGrant{Version: 1, ServerID: auth.ServerID, OwnerUserID: auth.OwnerUserID, MachineID: machine, SessionID: in.SessionID, Path: in.Path, Scope: "file", KeyID: in.KeyID, GrantVersion: auth.GrantVersion, IssuedAt: issued, ExpiresAt: minTime(expires, row.ExpiresAt), ConnectionID: auth.ConnectionID, ClientGrantID: auth.ClientGrantID, AccessVersion: auth.AccessVersion, LeaseEpoch: auth.LeaseEpoch, Scopes: auth.Scopes}, current, nil
}

func (s *Service) verifyFile(ctx context.Context, machine, raw, requested string) (FileGrant, *route, error) {
	if strings.HasPrefix(raw, "fg1.") {
		return s.verifyFileV1(ctx, machine, raw, requested)
	}
	denied := &resource.Error{Status: 403, Code: "permission_denied", Message: "文件授权无效"}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || len(raw) > 8192 {
		return FileGrant{}, nil, denied
	}
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	var grant FileGrant
	if err != nil || decodeMessage(payload, &grant) != nil || grant.Version != 1 || grant.ServerID != s.config.ServerID || grant.MachineID != machine || !validUUID(grant.OwnerUserID) || !validUUID(grant.SessionID) {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "relay", "operation", "verifyFile", "error", err)
		}
		return grant, nil, denied
	}
	state, err := s.devices.State(ctx, grant.OwnerUserID, machine)
	if err != nil {
		var fault *resource.Error
		if errors.As(err, &fault) {
			return grant, nil, denied
		}
		return grant, nil, err
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	message, encodeErr := FileGrantBytes(grant)
	if encodeErr != nil {
		return grant, nil, encodeErr
	}
	if err != nil || len(state.PublicKey) != ed25519.PublicKeySize || grant.KeyID != state.KeyID || !ed25519.Verify(state.PublicKey, message, signature) {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "relay", "operation", "verifyFile", "error", err)
		}
		return grant, nil, denied
	}
	now := time.Now()
	if grant.ExpiresAt.Sub(grant.IssuedAt) > 5*time.Minute || grant.ExpiresAt.Before(grant.IssuedAt) || grant.IssuedAt.After(now.Add(5*time.Second)) || !now.Before(grant.ExpiresAt) || grant.GrantVersion != state.GrantVersion || state.RemoteAccessState != "enabled" {
		return grant, nil, denied
	}
	if !safePath(requested) || !safePath("/"+grant.Path) || !(grant.Scope == "file" && requested == "/"+grant.Path || grant.Scope == "directory" && strings.HasPrefix(requested, "/"+strings.TrimSuffix(grant.Path, "/")+"/")) {
		return grant, nil, denied
	}
	current := s.current(target{grant.OwnerUserID, machine})
	if current == nil {
		return grant, nil, &resource.Error{Status: 503, Code: "device_offline", Message: "目标执行端离线"}
	}
	valid, err := s.identity.VerifyGrant(ctx, current.principal)
	if err != nil {
		return grant, nil, err
	}
	if !valid {
		return grant, nil, denied
	}
	return grant, current, nil
}

func (s *Service) file(w http.ResponseWriter, r *http.Request) {
	origin, err := url.Parse(s.config.FilesOrigin)
	if err != nil {
		logging.Diagnostic(r.Context(), s.logger, slog.LevelError, "relay.file.failed", err)
		failure(r.Context(), w, 500, "internal_error")
		return
	}
	if !strings.EqualFold(r.Host, origin.Host) || r.Method != "GET" && r.Method != "HEAD" {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	machine, raw := chi.URLParam(r, "machine"), chi.URLParam(r, "grant")
	requested, pathErr := requestPath(r, "/"+chi.URLParam(r, "*"))
	if pathErr != nil || !safePath(requested) {
		if pathErr != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "file", "error", pathErr)
		}
		failure(r.Context(), w, 400, "invalid_request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	grant, current, err := s.verifyFile(ctx, machine, raw, requested)
	cancel()
	if err != nil {
		fail(r.Context(), w, err)
		return
	}
	a := &access{id: grant.ConnectionID, clientGrant: grant.ClientGrantID, accessVersion: grant.AccessVersion, verifiedAt: time.Now(), expiresAt: grant.ExpiresAt, fileExpiresAt: grant.ExpiresAt, scopes: slices.Clone(grant.Scopes), grantVersion: grant.GrantVersion}
	assertion := ""
	if grant.ConnectionID != "" {
		assertion, err = signWire(s.key, s.kid, map[string]any{"type": "monkeyai.access.assertion.v1", "issuer": s.config.PublicURL, "audience": "monkeyai-runtime", "kid": s.kid,
			"authorization": map[string]any{"server_id": s.config.ServerID, "owner_user_id": grant.OwnerUserID, "machine_id": machine, "connection_id": grant.ConnectionID, "client_grant_id": grant.ClientGrantID,
				"grant_version": grant.GrantVersion, "access_version": grant.AccessVersion, "lease_epoch": grant.LeaseEpoch, "scopes": grant.Scopes}, "expires_at": grant.ExpiresAt.UTC().Format(time.RFC3339Nano)})
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "relay", "operation", "file", "error", err)
			failure(r.Context(), w, 503, "authorization_state_unavailable")
			return
		}
	}
	s.forward(w, r, current, a, true, "/files/"+raw+requested, assertion, true)
}
