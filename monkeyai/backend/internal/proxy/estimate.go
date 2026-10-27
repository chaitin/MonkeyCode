package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/tiktoken-go/tokenizer"
)

const maxEstimateBytes = 32 << 20

var (
	o200kCodec = sync.OnceValue(func() tokenizer.Codec {
		codec, err := tokenizer.Get(tokenizer.O200kBase)
		if err != nil {
			slog.Error("加载分词器失败", "error", err)
			return nil
		}
		return codec
	})
	cl100kCodec = sync.OnceValue(func() tokenizer.Codec {
		codec, err := tokenizer.Get(tokenizer.Cl100kBase)
		if err != nil {
			slog.Error("加载分词器失败", "error", err)
			return nil
		}
		return codec
	})
)

type tokenEstimate struct {
	request   map[string]any
	codec     tokenizer.Codec
	source    string
	parts     map[string]*strings.Builder
	partial   map[string]bool
	size      int
	supported bool
	seen      bool
	complete  bool
}

func newTokenEstimate(pc *proxyContext) *tokenEstimate {
	if pc == nil || len(pc.requestBody) == 0 {
		return nil
	}
	e := &tokenEstimate{source: "heuristic", supported: true, parts: make(map[string]*strings.Builder), partial: make(map[string]bool)}
	var err error
	e.request, err = estimateObject(pc.requestBody)
	if err != nil {
		slog.Warn("操作失败", "module", "proxy", "operation", "newTokenEstimate", "error", err)
		return nil
	}
	model := pc.target.UpstreamModel
	if model == "" {
		model, _ = e.request["model"].(string)
	}
	switch {
	case strings.HasPrefix(model, "gpt-5"), strings.HasPrefix(model, "gpt-4.1"), strings.HasPrefix(model, "gpt-4o"),
		model == "o1", strings.HasPrefix(model, "o1-"), model == "o3", strings.HasPrefix(model, "o3-"), model == "o4", strings.HasPrefix(model, "o4-"):
		e.codec = o200kCodec()
	case strings.HasPrefix(model, "gpt-4"), strings.HasPrefix(model, "gpt-3.5"), strings.HasPrefix(model, "gpt-35"):
		e.codec = cl100kCodec()
	}
	if e.codec != nil {
		e.source = "tokenizer:" + e.codec.GetName()
	}
	return e
}

func estimateObject(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var object map[string]any
	err := decoder.Decode(&object)
	return object, err
}

func (e *tokenEstimate) count(text string) uint64 {
	if e.codec != nil {
		if n, err := e.codec.Count(text); err == nil {
			return uint64(n)
		}
		e.source = "heuristic"
	}
	// ASCII 文本约四字符一个 token，其他字符按一个 token 估算。
	var ascii, other uint64
	for _, r := range text {
		if r < utf8.RuneSelf {
			ascii++
		} else {
			other++
		}
	}
	return (ascii+3)/4 + other
}

func (e *tokenEstimate) append(key, text string) {
	if e.size+len(text) > maxEstimateBytes {
		e.supported = false
		return
	}
	part := e.parts[key]
	if part == nil {
		part = new(strings.Builder)
		e.parts[key] = part
	}
	part.WriteString(text)
	e.size += len(text)
}

func (e *tokenEstimate) replace(key, text string) {
	if part := e.parts[key]; part != nil {
		e.size -= part.Len()
		delete(e.parts, key)
	}
	e.append(key, text)
}

func (e *tokenEstimate) content(key string, value any) {
	switch v := value.(type) {
	case nil:
	case string:
		e.replace(key, v)
	case []any:
		for i, item := range v {
			e.content(fmt.Sprintf("%s/%d", key, i), item)
		}
	case map[string]any:
		switch v["type"] {
		case "text", "input_text", "output_text":
			e.content(key+"/text", v["text"])
		case "thinking":
			e.content(key+"/thinking", v["thinking"])
		case "reasoning":
			e.content(key+"/summary", v["summary"])
			e.content(key+"/content", v["content"])
			if v["encrypted_content"] != nil {
				e.supported = false
			}
		case "summary_text", "reasoning_text":
			e.content(key+"/text", v["text"])
		case "refusal":
			e.content(key+"/refusal", v["refusal"])
		case "tool_use":
			e.content(key+"/name", v["name"])
			e.jsonPart(key+"/arguments", v["input"])
		case "function_call":
			e.content(key+"/name", v["name"])
			e.content(key+"/arguments", v["arguments"])
		case "tool_result":
			e.content(key+"/content", v["content"])
		case "function_call_output":
			e.content(key+"/output", v["output"])
		case "message", nil:
			if _, ok := v["role"].(string); !ok {
				e.supported = false
				return
			}
			e.message(key, v)
		default:
			e.supported = false
		}
	default:
		e.supported = false
	}
}

func (e *tokenEstimate) jsonPart(key string, value any) {
	if value == nil {
		return
	}
	data, err := json.Marshal(value)
	if err != nil {
		slog.Warn("操作失败", "module", "proxy", "operation", "jsonPart", "error", err)
		e.supported = false
		return
	}
	e.replace(key, string(data))
}

func (e *tokenEstimate) message(key string, message map[string]any) {
	for _, field := range []string{"content", "reasoning_content", "reasoning", "refusal"} {
		e.content(key+"/"+field, message[field])
	}
	if call, ok := message["function_call"].(map[string]any); ok {
		e.content(key+"/function/name", call["name"])
		e.content(key+"/function/arguments", call["arguments"])
	}
	if calls, ok := message["tool_calls"].([]any); ok {
		for i, value := range calls {
			call, ok := value.(map[string]any)
			if !ok {
				e.supported = false
				continue
			}
			function, ok := call["function"].(map[string]any)
			if !ok {
				e.supported = false
				continue
			}
			prefix := fmt.Sprintf("%s/tool/%d", key, i)
			e.content(prefix+"/name", function["name"])
			e.content(prefix+"/arguments", function["arguments"])
		}
	}
	if message["audio"] != nil {
		e.supported = false
	}
}

func (e *tokenEstimate) tokens() uint64 {
	var n uint64
	for _, part := range e.parts {
		n += e.count(part.String())
	}
	return n
}

func (e *tokenEstimate) input() (uint64, bool) {
	input := &tokenEstimate{codec: e.codec, source: e.source, supported: true, parts: make(map[string]*strings.Builder)}
	var overhead uint64 = 3
	seen := false
	for _, field := range []string{"system", "instructions", "messages", "input"} {
		value, ok := e.request[field]
		if !ok {
			continue
		}
		seen = true
		input.content(field, value)
		if messages, ok := value.([]any); ok {
			for _, value := range messages {
				if message, ok := value.(map[string]any); ok {
					overhead += 3
					for _, name := range []string{"role", "name"} {
						if text, ok := message[name].(string); ok {
							overhead += input.count(text)
						}
					}
				}
			}
		}
	}
	for _, field := range []string{"tools", "functions", "tool_choice", "response_format", "text"} {
		input.jsonPart(field, e.request[field])
	}
	for _, field := range []string{"previous_response_id", "conversation"} {
		if value := e.request[field]; value != nil && value != "" {
			input.supported = false
		}
	}
	n := input.tokens() + overhead
	if input.source == "heuristic" {
		e.source = "heuristic"
	}
	return n, seen && input.supported
}

func (e *tokenEstimate) response(path string, data []byte) {
	if e == nil {
		return
	}
	response, err := estimateObject(data)
	if err != nil || response == nil {
		if err != nil {
			slog.Warn("操作失败", "module", "proxy", "operation", "response", "error", err)
		}
		e.supported = false
		return
	}
	if wrapped, ok := response["response"].(map[string]any); ok {
		response = wrapped
	}
	switch path {
	case "/v1/chat/completions":
		if choices, ok := response["choices"].([]any); ok {
			for i, value := range choices {
				choice, _ := value.(map[string]any)
				if message, ok := choice["message"].(map[string]any); ok {
					e.seen = true
					e.message(fmt.Sprintf("choice/%d", i), message)
				}
			}
		}
		e.complete = e.seen
	case "/v1/responses", "/v1/messages":
		field := "output"
		if path == "/v1/messages" {
			field = "content"
		}
		if content, ok := response[field].([]any); ok {
			e.parts = make(map[string]*strings.Builder)
			e.size = 0
			e.seen = true
			e.content(field, content)
		}
		status, _ := response["status"].(string)
		e.complete = e.seen && (status == "" || status == "completed")
	}
}

func (e *tokenEstimate) event(path string, event sseEvent) {
	if e == nil {
		return
	}
	if event.Type == "done" {
		e.complete = e.seen
		return
	}
	data, err := estimateObject(event.Data)
	if err != nil || data == nil {
		if err != nil {
			slog.Warn("操作失败", "module", "proxy", "operation", "event", "error", err)
		}
		e.supported = false
		return
	}
	switch path {
	case "/v1/chat/completions":
		choices, _ := data["choices"].([]any)
		for _, value := range choices {
			choice, _ := value.(map[string]any)
			delta, ok := choice["delta"].(map[string]any)
			if !ok {
				continue
			}
			e.seen = true
			key := fmt.Sprintf("choice/%v", choice["index"])
			for _, field := range []string{"content", "reasoning_content", "reasoning", "refusal"} {
				if text, ok := delta[field].(string); ok {
					e.append(key+"/"+field, text)
				} else if delta[field] != nil {
					e.supported = false
				}
			}
			if call, ok := delta["function_call"].(map[string]any); ok {
				e.callDelta(key+"/function", call)
			}
			calls, _ := delta["tool_calls"].([]any)
			for _, value := range calls {
				call, _ := value.(map[string]any)
				function, ok := call["function"].(map[string]any)
				if !ok {
					e.supported = false
					continue
				}
				e.callDelta(fmt.Sprintf("%s/tool/%v", key, call["index"]), function)
			}
			if delta["audio"] != nil {
				e.supported = false
			}
			if reason, ok := choice["finish_reason"].(string); ok && reason != "" {
				e.complete = true
			}
		}
	case "/v1/messages":
		key := fmt.Sprintf("block/%v", data["index"])
		switch event.Type {
		case "message_start":
			if message, ok := data["message"].(map[string]any); ok {
				if content, ok := message["content"].([]any); ok {
					e.seen = true
					e.content("initial", content)
				}
			}
		case "content_block_start":
			e.seen = true
			e.content(key, data["content_block"])
		case "content_block_delta":
			delta, _ := data["delta"].(map[string]any)
			for _, field := range []string{"text", "thinking"} {
				if text, ok := delta[field].(string); ok {
					e.seen = true
					e.append(key+"/"+field, text)
				}
			}
			if text, ok := delta["partial_json"].(string); ok {
				e.seen = true
				if !e.partial[key] {
					e.replace(key+"/arguments", "")
					e.partial[key] = true
				}
				e.append(key+"/arguments", text)
			}
		case "message_stop":
			e.complete = e.seen
		}
	case "/v1/responses":
		key := fmt.Sprintf("item/%v", data["output_index"])
		switch event.Type {
		case "response.output_text.delta", "response.refusal.delta", "response.reasoning_text.delta", "response.reasoning_summary_text.delta":
			if text, ok := data["delta"].(string); ok {
				e.seen = true
				e.append(fmt.Sprintf("%s/%s/%v/%v", key, event.Type, data["content_index"], data["summary_index"]), text)
			}
		case "response.function_call_arguments.delta":
			if text, ok := data["delta"].(string); ok {
				e.seen = true
				e.append(key+"/arguments", text)
			}
		case "response.output_item.added":
			if item, ok := data["item"].(map[string]any); ok {
				switch item["type"] {
				case "function_call":
					e.seen = true
					e.content(key+"/name", item["name"])
				case "message", "reasoning":
				default:
					e.supported = false
				}
			}
		case "response.output_item.done":
			for part, value := range e.parts {
				if strings.HasPrefix(part, key+"/") {
					e.size -= value.Len()
					delete(e.parts, part)
				}
			}
			e.seen = true
			e.content(key, data["item"])
		case "response.completed":
			e.response(path, event.Data)
			e.complete = e.seen
		}
	}
}

func (e *tokenEstimate) callDelta(key string, function map[string]any) {
	for _, field := range []string{"name", "arguments"} {
		if text, ok := function[field].(string); ok {
			e.append(key+"/"+field, text)
		}
	}
}

func (e *tokenEstimate) apply(result usageResult) usageResult {
	if e == nil || result.Known {
		return result
	}
	inputKnown, outputKnown := result.inputKnown, result.outputKnown
	if !inputKnown {
		input, supported := e.input()
		// Anthropic 缓存用量是输入的独立分项，本地估算的是输入总量。
		cache := result.CacheReadInputTokens + result.CacheCreationInputTokens
		if input < cache+result.CachedTokens {
			input = cache + result.CachedTokens
		}
		result.InputTokens = input - cache
		result.InputSource = e.source
		inputKnown = supported
	}
	if !outputKnown && e.seen {
		result.OutputTokens = e.tokens()
		result.OutputSource = e.source
		outputKnown = e.supported
	}
	if inputKnown && outputKnown && e.complete && result.Result != "failed" &&
		(result.ErrorCode == "usage_missing" || result.ErrorCode == "usage_incomplete" || result.ErrorCode == "usage_terminal_event_missing") {
		result.Known = true
		result.ErrorCode = ""
	}
	return result
}
