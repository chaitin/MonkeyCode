package llmproxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const ohMyAgentSignatureHeader = "X-OhMyAgent-Signature"

var ErrInvalidOhMyAgentPrompt = errors.New("invalid ohmyagent prompt")

func ValidateOhMyAgentPrompt(body []byte, signature, secret string) error {
	if secret == "" {
		return fmt.Errorf("%w: signing secret is empty", ErrInvalidOhMyAgentPrompt)
	}
	prompt, err := extractOhMyAgentSystemPrompt(body)
	if err != nil {
		return err
	}
	provided, err := decodeOhMyAgentSignature(signature)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(prompt))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return fmt.Errorf("%w: signature mismatch", ErrInvalidOhMyAgentPrompt)
	}
	return nil
}

func decodeOhMyAgentSignature(signature string) ([]byte, error) {
	encoded, ok := strings.CutPrefix(strings.TrimSpace(signature), "v1=")
	if !ok {
		return nil, fmt.Errorf("%w: unsupported signature", ErrInvalidOhMyAgentPrompt)
	}
	decoded, err := hex.DecodeString(encoded)
	if err != nil || len(decoded) != sha256.Size {
		return nil, fmt.Errorf("%w: malformed signature", ErrInvalidOhMyAgentPrompt)
	}
	return decoded, nil
}

type ohMyAgentPromptPayload struct {
	Messages     []ohMyAgentMessage `json:"messages"`
	Input        []ohMyAgentMessage `json:"input"`
	Instructions json.RawMessage    `json:"instructions"`
	System       json.RawMessage    `json:"system"`
}

type ohMyAgentMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

func extractOhMyAgentSystemPrompt(body []byte) (string, error) {
	var payload ohMyAgentPromptPayload
	if len(body) == 0 || json.Unmarshal(body, &payload) != nil {
		return "", fmt.Errorf("%w: invalid request body", ErrInvalidOhMyAgentPrompt)
	}
	if prompt, ok := decodeFirstOhMyAgentPromptBlock(payload.System); ok {
		return prompt, nil
	}
	if prompt, ok := decodeOhMyAgentPrompt(payload.Instructions); ok {
		return prompt, nil
	}
	for _, message := range payload.Messages {
		if message.Role == "system" {
			if prompt, ok := decodeOhMyAgentPrompt(message.Content); ok {
				return prompt, nil
			}
			break
		}
	}
	for _, message := range payload.Input {
		if message.Role == "developer" || message.Role == "system" {
			if prompt, ok := decodeOhMyAgentPrompt(message.Content); ok {
				return prompt, nil
			}
			break
		}
	}
	return "", fmt.Errorf("%w: system prompt not found", ErrInvalidOhMyAgentPrompt)
}

func decodeFirstOhMyAgentPromptBlock(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, text != ""
	}
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return "", false
	}
	if len(parts) == 0 || parts[0].Text == "" {
		return "", false
	}
	return parts[0].Text, true
}

func decodeOhMyAgentPrompt(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, text != ""
	}
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return "", false
	}
	texts := make([]string, 0, len(parts))
	for _, part := range parts {
		if part.Text != "" {
			texts = append(texts, part.Text)
		}
	}
	if len(texts) == 0 {
		return "", false
	}
	return strings.Join(texts, "\n"), true
}
