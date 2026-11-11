package proxy

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func legacyEstimateObject(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var object map[string]any
	err := decoder.Decode(&object)
	return object, err
}

func compareEstimateEvent(t testing.TB, data []byte) {
	t.Helper()
	for _, route := range []struct {
		path, kind string
	}{
		{"/v1/chat/completions", ""},
		{"/v1/messages", "message_start"}, {"/v1/messages", "content_block_start"},
		{"/v1/messages", "content_block_delta"}, {"/v1/messages", "message_stop"},
		{"/v1/responses", "response.output_text.delta"},
		{"/v1/responses", "response.function_call_arguments.delta"},
		{"/v1/responses", "response.output_item.added"},
		{"/v1/responses", "response.output_item.done"}, {"/v1/responses", "response.completed"},
	} {
		fresh := func() *tokenEstimate {
			return &tokenEstimate{source: "heuristic", supported: true, parts: map[string]*strings.Builder{}, partial: map[string]bool{}}
		}
		want, got := fresh(), fresh()
		object, err := legacyEstimateObject(data)
		if err != nil || object == nil {
			want.supported = false
		} else {
			want.consumeEvent(route.path, sseEvent{Type: route.kind, Data: data}, object)
		}
		got.event(route.path, sseEvent{Type: route.kind, Data: data}, readEvent(data))
		parts := func(e *tokenEstimate) map[string]string {
			out := map[string]string{}
			for key, part := range e.parts {
				out[key] = part.String()
			}
			return out
		}
		if got.supported != want.supported || got.seen != want.seen || got.complete != want.complete ||
			got.size != want.size || !reflect.DeepEqual(got.partial, want.partial) || !reflect.DeepEqual(parts(got), parts(want)) {
			t.Fatalf("估算事件不兼容: path=%s type=%s data=%q got=%+v parts=%v want=%+v parts=%v",
				route.path, route.kind, data, got, parts(got), want, parts(want))
		}
	}
}

func TestEstimateEventCompatibility(t *testing.T) {
	for _, data := range []string{
		`null`, `{}`, `[]`, `{} trailing`,
		`{"choices":[{"index":9007199254740993,"delta":{"content":"hello","reasoning_content":"think"},"finish_reason":"stop"}]}`,
		`{"choices":[{"index":"name","delta":{"content":"hello"}}]}`,
		`{"choices":[{"index":{"n":9007199254740993},"delta":{"content":"hello"}}]}`,
		`{"choices":[{"delta":null},{"delta":{}},{"delta":{"Content":"ignored"}}]}`,
		`{"choices":[{"delta":{"content":null,"refusal":false}}]}`,
		`{"choices":[{"delta":{"content":"first","content":"last"}}]}`,
		`{"choices":[{"delta":{"function_call":{"name":"read","arguments":"{}"},"tool_calls":[{"index":1e3,"function":{"name":"tool","arguments":"hello"}},null]}}]}`,
		`{"choices":[{"delta":{"audio":false}}]}`,
		`{"index":9007199254740993,"delta":{"text":"hello","thinking":"think","partial_json":"{\"n\":9007199254740993}"}}`,
		`{"index":{"n":9007199254740993},"content_block":{"type":"tool_use","name":"tool","input":{"n":9007199254740993}}}`,
		`{"output_index":9007199254740993,"content_index":1e3,"summary_index":"key","delta":"hello"}`,
		`{"output_index":0,"item":{"type":"function_call","name":"tool","arguments":"{\"n\":9007199254740993}"}}`,
		`{"response":{"status":"completed","output":[{"type":"tool_use","name":"tool","input":{"n":9007199254740993}}]}}`,
		`{"choices":[{"delta":{"content":"hello"}}]} trailing`,
	} {
		t.Run(data, func(t *testing.T) { compareEstimateEvent(t, []byte(data)) })
	}
}

func FuzzEstimateEventCompatibility(f *testing.F) {
	for _, seed := range []string{`null`, `{}`, `{"choices":[{"index":0,"delta":{"content":"hello"}}]}`, `{"index":9007199254740993,"delta":{"text":"hello"}}`, `{"delta":"hello"}`, `{"item":{"type":"tool_use","input":{"n":9007199254740993}}}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) { compareEstimateEvent(t, data) })
}
