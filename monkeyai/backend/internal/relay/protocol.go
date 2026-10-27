package relay

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
	"uuid"
)

const Version = 1
const maxControlMessage = 64 << 10

var errProtocol = errors.New("远程执行协议消息无效")

type Hello struct {
	Type               string           `json:"type"`
	TunnelVersion      int              `json:"tunnel_version"`
	ChannelKind        string           `json:"channel_kind"`
	MachineID          string           `json:"machine_id"`
	ExecutionPublicKey string           `json:"execution_public_key"`
	BootID             string           `json:"boot_id"`
	DisplayName        string           `json:"display_name"`
	Platform           string           `json:"platform"`
	Arch               string           `json:"arch"`
	DeploymentMode     string           `json:"deployment_mode"`
	Intent             string           `json:"intent"`
	RestoreRevoked     bool             `json:"restore_revoked"`
	LeaseEpoch         int64            `json:"lease_epoch"`
	RuntimeVersion     string           `json:"runtime_version,omitempty"`
	EngineVersion      string           `json:"engine_version,omitempty"`
	Protocols          map[string][]int `json:"protocols"`
}

type Challenge struct {
	Type                string    `json:"type"`
	ServerID            string    `json:"server_id"`
	OwnerUserID         string    `json:"owner_user_id"`
	ChallengeID         string    `json:"challenge_id"`
	Nonce               string    `json:"nonce"`
	TTLMS               int64     `json:"ttl_ms"`
	ServerTime          time.Time `json:"server_time"`
	GrantID             string    `json:"grant_id"`
	RegistrationVersion int64     `json:"registration_version"`
}

type Proof struct {
	Type        string `json:"type"`
	ChallengeID string `json:"challenge_id"`
	Signature   string `json:"signature"`
}

type Ready struct {
	Type                string            `json:"type"`
	ServerID            string            `json:"server_id"`
	MachineID           string            `json:"machine_id"`
	RegistrationVersion int64             `json:"registration_version"`
	GrantVersion        int64             `json:"grant_version"`
	LeaseEpoch          int64             `json:"lease_epoch,omitempty"`
	Bound               bool              `json:"bound,omitempty"`
	PublicAddresses     map[string]string `json:"public_addresses,omitempty"`
}

type ReadyAck struct {
	Type                string `json:"type"`
	RegistrationVersion int64  `json:"registration_version"`
	LeaseEpoch          int64  `json:"lease_epoch,omitempty"`
}

// ProofBytes encodes the shared fixed-array proof payload.
func ProofBytes(hello Hello, challenge Challenge) ([]byte, error) {
	return json.Marshal([]any{
		"monkeyai.endpoint.proof.v1",
		[]any{hello.TunnelVersion, hello.ChannelKind, hello.Intent, hello.MachineID,
			hello.ExecutionPublicKey, hello.BootID, hello.DisplayName, hello.Platform,
			hello.Arch, hello.DeploymentMode, hello.LeaseEpoch, hello.RestoreRevoked,
			hello.Protocols["acp"], hello.Protocols["runtime_api"]},
		[]any{challenge.ServerID, challenge.OwnerUserID, challenge.ChallengeID, challenge.Nonce,
			challenge.TTLMS, challenge.ServerTime, challenge.GrantID, challenge.RegistrationVersion},
	})
}

func validUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value && len(value) == 36 && value[14] == '4' && strings.ContainsRune("89ab", rune(value[19]))
}

func validProtocols(protocols map[string][]int) bool {
	if len(protocols) != 2 {
		return false
	}
	for _, name := range []string{"acp", "runtime_api"} {
		versions, ok := protocols[name]
		if !ok || len(versions) == 0 || len(versions) > 8 || !slices.IsSorted(versions) {
			return false
		}
		for i, version := range versions {
			if version <= 0 || version > 65535 || i > 0 && versions[i-1] == version {
				return false
			}
		}
	}
	return true
}

func validateHello(h Hello, channel string, tunnelVersion int) ([]byte, error) {
	if h.Type != "hello" || h.TunnelVersion != tunnelVersion || tunnelVersion != Version || h.ChannelKind != channel || !validUUID(h.MachineID) || !validUUID(h.BootID) || !validProtocols(h.Protocols) {
		return nil, errProtocol
	}
	if !slices.Contains([]string{"macos", "windows", "linux"}, h.Platform) || h.DisplayName == "" || h.Arch == "" || !slices.Contains([]string{"desktop_managed", "standalone"}, h.DeploymentMode) {
		return nil, errProtocol
	}
	if channel == "data" {
		if h.Intent != "attach" || h.LeaseEpoch <= 0 || h.RestoreRevoked {
			return nil, errProtocol
		}
	} else if !slices.Contains([]string{"publish", "bind_identity"}, h.Intent) || h.LeaseEpoch != 0 {
		return nil, errProtocol
	}
	public, err := base64.RawURLEncoding.Strict().DecodeString(h.ExecutionPublicKey)
	if err != nil || len(public) != ed25519.PublicKeySize {
		if err != nil {
			slog.Warn("操作失败", "module", "relay", "operation", "validateHello", "error", err)
		}
		return nil, errProtocol
	}
	return public, nil
}

func decodeMessage(data []byte, out any) error {
	if len(data) > maxControlMessage || !utf8.Valid(data) {
		return errProtocol
	}
	check := json.NewDecoder(bytes.NewReader(data))
	check.UseNumber()
	if err := checkJSON(check, 0); err != nil {
		slog.Warn("操作失败", "module", "relay", "operation", "decodeMessage", "error", err)
		return errProtocol
	}
	if _, err := check.Token(); err != io.EOF {
		return errProtocol
	}
	if !messageFields(data, reflect.TypeOf(out)) {
		return errProtocol
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		slog.Warn("操作失败", "module", "relay", "operation", "decodeMessage", "error", err)
		return errProtocol
	}
	return nil
}

func messageFields(data json.RawMessage, typ reflect.Type) bool {
	if typ == nil {
		return true
	}
	for typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	if typ == reflect.TypeFor[time.Time]() {
		return true
	}
	if typ.Kind() != reflect.Struct {
		return true
	}
	fields := make(map[string]reflect.Type)
	for _, field := range reflect.VisibleFields(typ) {
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name != "" && name != "-" {
			fields[name] = field.Type
		}
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil {
		return false
	}
	for name, value := range object {
		field, ok := fields[name]
		if !ok || !messageFields(value, field) {
			return false
		}
	}
	return true
}

func checkJSON(d *json.Decoder, depth int) error {
	if depth > 32 {
		return errProtocol
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	delim, compound := token.(json.Delim)
	if !compound {
		if depth == 0 {
			return errProtocol
		}
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]bool)
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return errProtocol
			}
			seen[name] = true
			if err := checkJSON(d, depth+1); err != nil {
				return err
			}
		}
	case '[':
		if depth == 0 {
			return errProtocol
		}
		for d.More() {
			if err := checkJSON(d, depth+1); err != nil {
				return err
			}
		}
	default:
		return errProtocol
	}
	end, err := d.Token()
	if err != nil || delim == '{' && end != json.Delim('}') || delim == '[' && end != json.Delim(']') {
		if err != nil {
			slog.Warn("操作失败", "module", "relay", "operation", "checkJSON", "error", err)
		}
		return errProtocol
	}
	return nil
}
