package proxy

import (
	"strings"
	"testing"
)

func BenchmarkRewriteModel(b *testing.B) {
	for _, size := range []struct {
		name string
		text string
	}{{"small", "hello"}, {"large", strings.Repeat("hello world ", 1<<16)}} {
		body := []byte(`{"model":"alias","messages":[{"role":"user","content":"` + size.text + `"}],"tools":[{"type":"function","function":{"name":"read"}}]}`)
		b.Run(size.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if _, err := rewriteModel(body, "actual-model"); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkEstimateUsage(b *testing.B) {
	request := []byte(`{"model":"custom","messages":[{"role":"user","content":"` + strings.Repeat("hello world ", 1<<16) + `"}]}`)
	pc := &proxyContext{requestBody: request}
	for _, mode := range []string{"known", "fallback"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				e := newTokenEstimate(pc)
				if e == nil {
					b.Fatal("估算器未初始化")
				}
				e.complete = true
				result := usageResult{Known: true, InputTokens: 10, OutputTokens: 2}
				if mode == "fallback" {
					result.Known, result.outputKnown, result.ErrorCode = false, true, "usage_incomplete"
				}
				got := e.apply(result)
				if !got.Known || got.OutputTokens != 2 || (mode == "known" && got.InputTokens != 10) || (mode == "fallback" && got.InputTokens <= 10) {
					b.Fatalf("用量被改变: %+v", got)
				}
			}
		})
	}
}

func BenchmarkStreamUsage(b *testing.B) {
	for _, test := range []struct {
		name, path, data string
	}{
		{"chat", "/v1/chat/completions", strings.Repeat("data: {\"id\":\"call\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello world\"}}]}\n\n", 100) + "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20}}\n\ndata: [DONE]\n\n"},
		{"responses", "/v1/responses", strings.Repeat("event: response.output_text.delta\ndata: {\"output_index\":0,\"content_index\":0,\"delta\":\"hello world\"}\n\n", 100) + "event: response.completed\ndata: {\"response\":{\"id\":\"call\",\"status\":\"completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":20}}}\n\n"},
		{"messages", "/v1/messages", "event: message_start\ndata: {\"message\":{\"id\":\"call\",\"usage\":{\"input_tokens\":10}}}\n\n" + strings.Repeat("event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"text\":\"hello world\"}}\n\n", 100) + "event: message_delta\ndata: {\"usage\":{\"output_tokens\":20}}\n\nevent: message_stop\ndata: {}\n\n"},
	} {
		b.Run(test.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				result := captureEstimate(test.path, true, `{"model":"custom","messages":[{"role":"user","content":"hello"}]}`, test.data)
				if !result.Known || result.InputTokens != 10 || result.OutputTokens != 20 {
					b.Fatalf("用量不正确: %+v", result)
				}
			}
		})
	}
}
