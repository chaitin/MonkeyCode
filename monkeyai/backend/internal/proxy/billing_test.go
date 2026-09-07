package proxy

import (
	"encoding/json"
	"testing"
)

func TestEnforcedRequestLimits(t *testing.T) {
	for _, path := range []string{"/v1/chat/completions", "/v1/responses", "/v1/messages"} {
		out, err := billRequest([]byte(`{"max_tokens":99999,"max_completion_tokens":99999}`), path, 100, true)
		if err != nil {
			t.Fatal(err)
		}
		var data map[string]any
		if err = json.Unmarshal(out, &data); err != nil {
			t.Fatal(err)
		}
		field := "max_tokens"
		if path == "/v1/responses" {
			field = "max_output_tokens"
		}
		if data[field] != float64(100) {
			t.Fatalf("未强制输出限制: %s", out)
		}
		if path == "/v1/chat/completions" && data["stream_options"].(map[string]any)["include_usage"] != true {
			t.Fatal("未请求流式用量")
		}
	}
}

func TestStreamUsageCompleteness(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		known            bool
		result           string
	}{
		{"缺失用量的结束事件", "/v1/messages", "event: message_stop\ndata: {}\n\n", false, ""},
		{"只有输入的中断", "/v1/messages", "event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":12}}}\n\nevent: message_stop\ndata: {}\n\n", false, ""},
		{"可信零用量", "/v1/messages", "event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: message_delta\ndata: {\"usage\":{\"output_tokens\":0}}\n\nevent: message_stop\ndata: {}\n\n", true, ""},
		{"不完整响应仍有计费事实", "/v1/responses", "event: response.incomplete\ndata: {\"response\":{\"id\":\"r\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}}\n\n", true, "failed"},
		{"usage后还有空分片", "/v1/chat/completions", "data: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\ndata: {\"choices\":[]}\n\ndata: [DONE]\n\n", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := newUsageCaptureForTest(tc.path, true, tc.body).handleStream()
			if got.Known != tc.known || got.Result != tc.result {
				t.Fatalf("用量可信度不符: %+v", got)
			}
		})
	}
}

func TestIncompleteUsageIsNotFreeUsage(t *testing.T) {
	for _, path := range []string{"/v1/chat/completions", "/v1/responses", "/v1/messages"} {
		if got := newUsageCaptureForTest(path, false, `{"id":"r","usage":{}}`).handleNonStream(); got.Known {
			t.Fatalf("%s 空 usage 不代表零用量", path)
		}
	}
}
