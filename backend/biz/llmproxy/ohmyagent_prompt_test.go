package llmproxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

const (
	testOhMyAgentPrompt = "You are OhMyAgent, an AI coding agent for software engineering tasks."
	testSigningSecret   = "omas_test_secret"
)

func TestValidateOhMyAgentPromptProtocols(t *testing.T) {
	cases := map[string]any{
		"openai-chat": map[string]any{"messages": []map[string]any{
			{"role": "system", "content": testOhMyAgentPrompt},
			{"role": "system", "content": "dynamic"},
		}},
		"responses": map[string]any{
			"instructions": testOhMyAgentPrompt,
			"input":        []map[string]any{{"role": "developer", "content": "dynamic"}},
		},
		"anthropic": map[string]any{"system": []map[string]any{
			{"type": "text", "text": testOhMyAgentPrompt},
			{"type": "text", "text": "dynamic"},
		}},
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if err := ValidateOhMyAgentPrompt(body, testOhMyAgentSignature(testOhMyAgentPrompt), testSigningSecret); err != nil {
				t.Fatalf("ValidateOhMyAgentPrompt() error = %v", err)
			}
		})
	}
}

func TestValidateOhMyAgentPromptRejectsNonFirstAnthropicPrompt(t *testing.T) {
	body, err := json.Marshal(map[string]any{"system": []map[string]any{
		{"type": "text", "text": ""},
		{"type": "text", "text": testOhMyAgentPrompt},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateOhMyAgentPrompt(body, testOhMyAgentSignature(testOhMyAgentPrompt), testSigningSecret); err == nil {
		t.Fatal("ValidateOhMyAgentPrompt() error = nil")
	}
}

func TestValidateOhMyAgentPromptRejectsModifiedFirstPrompt(t *testing.T) {
	body, err := json.Marshal(map[string]any{"instructions": "modified"})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateOhMyAgentPrompt(body, testOhMyAgentSignature(testOhMyAgentPrompt), testSigningSecret); err == nil {
		t.Fatal("ValidateOhMyAgentPrompt() error = nil")
	}
}

func TestValidateOhMyAgentPromptRejectsInvalidCredentials(t *testing.T) {
	body, err := json.Marshal(map[string]any{"instructions": testOhMyAgentPrompt})
	if err != nil {
		t.Fatal(err)
	}
	for name, credentials := range map[string][2]string{
		"missing signature":   {"", testSigningSecret},
		"malformed signature": {"v1=invalid", testSigningSecret},
		"missing secret":      {testOhMyAgentSignature(testOhMyAgentPrompt), ""},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateOhMyAgentPrompt(body, credentials[0], credentials[1]); err == nil {
				t.Fatal("ValidateOhMyAgentPrompt() error = nil")
			}
		})
	}
}

func testOhMyAgentSignature(prompt string) string {
	mac := hmac.New(sha256.New, []byte(testSigningSecret))
	_, _ = mac.Write([]byte(prompt))
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}
