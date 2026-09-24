package endpoint

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
	"uuid"
)

const maxMessage = 256 << 10

var methodPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,127}$`)
var errInvalid = errors.New("invalid_message")

type Profile struct {
	DeviceName    string `json:"device_name"`
	Platform      string `json:"platform"`
	OSVersion     string `json:"os_version"`
	Arch          string `json:"arch"`
	ClientVersion string `json:"client_version"`
}

type Hello struct {
	Type      string  `json:"type"`
	Versions  []int   `json:"protocol_versions"`
	MachineID string  `json:"machine_id"`
	Profile   Profile `json:"profile"`
}

type Message struct {
	Type     string          `json:"type"`
	ID       string          `json:"message_id"`
	Target   string          `json:"target"`
	Method   string          `json:"method,omitempty"`
	ReplyTo  string          `json:"reply_to,omitempty"`
	Payload  json.RawMessage `json:"payload"`
	Source   string          `json:"source,omitempty"`
	RoutedAt int64           `json:"routed_at,omitempty"`
}

type wireError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Retryable  bool   `json:"retryable"`
	RetryAfter int    `json:"retry_after_ms,omitempty"`
}

type fault struct{ code string }

func (e fault) Error() string { return e.code }

func validID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && len(value) == 36 && id.String() == value && value[14] == '4' && strings.ContainsRune("89ab", rune(value[19]))
}

func text(value string, limit int) bool {
	return len(value) <= limit && strings.TrimSpace(value) != "" && utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}

// 逐层检查重复键，避免不同 JSON 解析器对同一信封产生不同解释。
func object(data []byte) (map[string]json.RawMessage, error) {
	if !utf8.Valid(data) {
		return nil, errInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := value(decoder, 0); err != nil {
		return nil, errInvalid
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errInvalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return nil, errInvalid
	}
	return fields, nil
}

func value(d *json.Decoder, depth int) error {
	if depth > 64 {
		return errInvalid
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	delim, compound := token.(json.Delim)
	if !compound {
		return nil
	}
	switch delim {
	case '{':
		keys := make(map[string]bool)
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || keys[name] {
				return errInvalid
			}
			keys[name] = true
			if err := value(d, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for d.More() {
			if err := value(d, depth+1); err != nil {
				return err
			}
		}
	default:
		return errInvalid
	}
	end, err := d.Token()
	if err != nil || (delim == '{' && end != json.Delim('}')) || (delim == '[' && end != json.Delim(']')) {
		return errInvalid
	}
	return nil
}

func reserved(fields map[string]json.RawMessage) bool {
	for _, key := range []string{"source", "routed_at", "user_id"} {
		if _, ok := fields[key]; ok {
			return true
		}
	}
	return false
}

// JSON 字段名区分大小写，避免 encoding/json 的折叠匹配接受未声明的信封字段。
func decode(fields map[string]json.RawMessage, out any, keys ...string) error {
	selected := make(map[string]json.RawMessage, len(keys))
	for _, key := range keys {
		if raw, ok := fields[key]; ok {
			selected[key] = raw
		}
	}
	data, err := json.Marshal(selected)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func hello(data []byte) (Hello, error) {
	var h Hello
	fields, err := object(data)
	if err != nil || len(data) > 4096 || reserved(fields) || decode(fields, &h, "type", "protocol_versions", "machine_id") != nil {
		return h, errInvalid
	}
	for _, key := range []string{"message_id", "target", "method", "reply_to", "payload"} {
		if _, ok := fields[key]; ok {
			return h, errInvalid
		}
	}
	if h.Type != "hello" || !validID(h.MachineID) || len(h.Versions) == 0 || len(h.Versions) > 8 {
		return h, errInvalid
	}
	versions := make(map[int]bool)
	for _, v := range h.Versions {
		if v <= 0 || versions[v] {
			return h, errInvalid
		}
		versions[v] = true
	}
	profile, err := object(fields["profile"])
	if err != nil || decode(profile, &h.Profile, "device_name", "platform", "os_version", "arch", "client_version") != nil {
		return h, errInvalid
	}
	p := h.Profile
	if !text(p.DeviceName, 128) || !text(p.OSVersion, 64) || !text(p.Arch, 32) || !text(p.ClientVersion, 64) || !slices.Contains([]string{"macos", "windows", "linux", "ios", "android"}, p.Platform) {
		return h, errInvalid
	}
	if !versions[1] {
		return h, fault{"unsupported_protocol"}
	}
	return h, nil
}

func message(data []byte) (Message, error) {
	var m Message
	fields, err := object(data)
	if err != nil || reserved(fields) || decode(fields, &m, "type", "message_id", "target", "method", "reply_to", "payload") != nil {
		return m, errInvalid
	}
	for _, key := range []string{"protocol_versions", "machine_id", "profile"} {
		if _, ok := fields[key]; ok {
			return m, errInvalid
		}
	}
	if !validID(m.ID) || !validID(m.Target) {
		return m, errInvalid
	}
	if _, err := object(m.Payload); err != nil {
		return m, errInvalid
	}
	switch m.Type {
	case "request", "event":
		if _, ok := fields["reply_to"]; ok {
			return m, errInvalid
		}
		if !methodPattern.MatchString(m.Method) {
			return m, errInvalid
		}
	case "response":
		if _, ok := fields["method"]; ok {
			return m, errInvalid
		}
		if !validID(m.ReplyTo) {
			return m, errInvalid
		}
	default:
		return m, errInvalid
	}
	return m, nil
}

func errorFrame(code, reply string) ([]byte, error) {
	descriptions := map[string]string{
		"invalid_message": "消息格式无效", "unsupported_protocol": "协议版本不兼容", "unauthorized": "凭据失效",
		"endpoint_revoked": "端点已停用", "endpoint_limit_exceeded": "端点数量达到上限", "target_unavailable": "目标不可用",
		"target_offline": "目标离线", "target_busy": "目标繁忙", "rate_limited": "请求过于频繁",
		"payload_too_large": "转发消息过大", "service_unavailable": "服务暂不可用",
	}
	e := wireError{Code: code, Message: descriptions[code], Retryable: slices.Contains([]string{"target_offline", "target_busy", "rate_limited", "service_unavailable"}, code)}
	if code == "rate_limited" {
		e.RetryAfter = 1000
	}
	frame := struct {
		Type  string    `json:"type"`
		Reply string    `json:"reply_to,omitempty"`
		Error wireError `json:"error"`
	}{"error", reply, e}
	return json.Marshal(frame)
}
