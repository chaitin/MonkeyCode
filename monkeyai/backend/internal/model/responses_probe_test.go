package model

import "testing"

func TestProbeRequestAnthropicAddsVersion(t *testing.T) {
	got, err := probeRequest(Model{
		Protocol: ProtocolAnthropic,
		BaseURL:  "https://api.anthropic.com",
		APIKey:   "secret",
		ModelID:  "claude",
	}, "ping")
	if err != nil {
		t.Fatal(err)
	}
	if got.URL != "https://api.anthropic.com/v1/messages" {
		t.Fatalf("URL = %s", got.URL)
	}
	if got.Header.Get("X-Api-Key") != "secret" || got.Header.Get("Anthropic-Version") != "2023-06-01" {
		t.Fatalf("鉴权头错误: %v", got.Header)
	}

	openai, err := probeRequest(Model{
		Protocol: ProtocolOpenAIChat,
		BaseURL:  "https://api.openai.com/v1",
		APIKey:   "secret",
		ModelID:  "gpt",
	}, "ping")
	if err != nil {
		t.Fatal(err)
	}
	if openai.URL != "https://api.openai.com/v1/chat/completions" || openai.Header.Get("Authorization") != "Bearer secret" {
		t.Fatalf("OpenAI 路径被改变: %s %s", openai.URL, openai.Header.Get("Authorization"))
	}
	if openai.Header.Get("X-Api-Key") != "" {
		t.Fatal("OpenAI 请求不应携带 Anthropic 密钥头")
	}
}

func TestProbeResponsesContent(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
		valid            bool
	}{
		{"nested", `{"output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}`, "pong", true},
		{"multiple", `{"output_text":" ","output":[{"type":"reasoning","content":[{"type":"output_text","text":"ignore"}]},{"type":"message","content":[{"type":"output_text","text":"one"},{"type":"output_text","text":" two"}]},{"type":"message","content":[{"type":"output_text","text":" three"}]}]}`, "one two three", true},
		{"top-level", `{"output_text":"pong","output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}`, "pong", true},
		{"no text", `{"output":[{"type":"message","content":[{"type":"refusal","text":"ignored"}]}]}`, "模型响应缺少合法文本内容", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, valid := probeContent(ProtocolOpenAIResponses, []byte(tc.body))
			if got != tc.want || valid != tc.valid {
				t.Fatalf("got (%q, %t), want (%q, %t)", got, valid, tc.want, tc.valid)
			}
		})
	}
}
