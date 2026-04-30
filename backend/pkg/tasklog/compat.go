package tasklog

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

func normalizeUserInputLogData(event, data string) string {
	if event != "user-input" {
		return data
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		return data
	}

	var content string
	if err := json.Unmarshal(payload["content"], &content); err != nil || strings.TrimSpace(content) == "" {
		return data
	}

	text, ok := DecodeLegacyUserInputContent(content)
	if !ok {
		return data
	}

	contentBytes, err := json.Marshal(text)
	if err != nil {
		return data
	}
	payload["content"] = contentBytes

	out, err := json.Marshal(payload)
	if err != nil {
		return data
	}
	return string(out)
}

func DecodeLegacyUserInputContent(content string) (string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(content)
	if err != nil || !utf8.Valid(decoded) {
		return content, false
	}
	text := string(decoded)
	if strings.TrimSpace(text) == "" {
		return content, false
	}
	return text, true
}
