package audit

import (
	"bytes"
	"encoding/json"
	"strings"
)

const bodyLimit = 64 << 10

// 未知字段默认脱敏，新增凭证类型不会因为遗漏黑名单而进入审计。
func sanitize(value any, depth int) any {
	if depth > 12 {
		return "[REDACTED]"
	}
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			switch key {
			case "before", "after", "request", "value", "settings", "settings_section", "authentication", "branding", "billing", "email", "smtp", "oauth", "providers", "advanced_config", "resources", "grants", "members", "quotas", "tools":
				out[key] = sanitize(item, depth+1)
			case "id", "name", "display_name", "model_id", "user_id", "user_ids", "group_id", "group_ids", "owner_user_id", "resource_id", "resource_type", "subject_type", "subject_id", "type", "role", "status", "enabled", "protocol", "ownership_type", "access_level", "usage_requirement", "schema_version", "revision", "amount", "reason", "mode", "charging_mode", "quota_refresh_cycle", "root_credits", "input_credits_per_million_tokens", "cached_input_credits_per_million_tokens", "output_credits_per_million_tokens", "credit_multiplier", "context_window_tokens", "max_output_tokens", "supports_vision", "supports_reasoning", "tag_ids", "rule_ids", "skill_ids", "expert_id", "provider_id", "connector_id", "external_user_id", "method", "route", "body_omitted":
				out[key] = sanitize(item, depth+1)
			default:
				out[key] = "[REDACTED]"
			}
		}
		return out
	case []any:
		if len(v) > 100 {
			return "[REDACTED]"
		}
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = sanitize(item, depth+1)
		}
		return out
	case string:
		return clean(v, 512)
	default:
		return value
	}
}

func clean(value string, limit int) string {
	runes := []rune(strings.ToValidUTF8(strings.ReplaceAll(value, "\x00", ""), ""))
	return string(runes[:min(len(runes), limit)])
}

func params(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var object map[string]any
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if d.Decode(&object) != nil || object == nil {
		object = map[string]any{}
	}
	return json.Marshal(sanitize(object, 0))
}
