package proxy

import (
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"strings"
)

type eventObject struct {
	data      []byte
	fields    map[string]json.RawMessage
	duplicate bool
	err       error
}

func readEvent(data []byte) eventObject {
	fields, duplicate, err := rawObject(data)
	return eventObject{data: data, fields: fields, duplicate: duplicate, err: err}
}

// 顶层重名或大小写别名需保留旧结构体的字段合并及错误语义。
func (e eventObject) legacy(names ...string) bool {
	if e.err != nil || e.duplicate {
		return true
	}
	for key := range e.fields {
		for _, name := range names {
			if key != name && strings.EqualFold(key, name) {
				return true
			}
		}
	}
	return false
}

func (e eventObject) estimate(path string) (map[string]any, error) {
	if e.err != nil || e.duplicate {
		return estimateObject(e.data)
	}
	if e.fields == nil {
		return nil, nil
	}
	var names []string
	switch path {
	case "/v1/chat/completions":
		names = []string{"choices"}
	case "/v1/messages":
		names = []string{"index", "message", "content_block", "delta"}
	case "/v1/responses":
		names = []string{"output_index", "content_index", "summary_index", "delta", "item", "response", "output", "status"}
	}
	out := make(map[string]any, len(names))
	for _, name := range names {
		value, exists := e.fields[name]
		if !exists {
			continue
		}
		var decoded any
		switch name {
		case "index", "output_index", "content_index", "summary_index":
			if value[0] == '-' || (value[0] >= '0' && value[0] <= '9') {
				decoded = json.Number(string(value))
				out[name] = decoded
				continue
			}
		}
		options := jsonv2.JoinOptions(json.DefaultOptionsV1(), estimateNumbers)
		if name == "delta" || name == "status" {
			options = json.DefaultOptionsV1()
		}
		if err := jsonv2.Unmarshal(value, &decoded, options); err != nil {
			return estimateObject(e.data)
		}
		out[name] = decoded
	}
	return out, nil
}

func (e eventObject) chat() (chatCompletion, error) {
	if e.legacy("id", "usage") {
		return parseChatCompletion(e.data)
	}
	var out chatCompletion
	for _, field := range []struct {
		name string
		out  any
	}{{"id", &out.ID}, {"usage", &out.Usage}} {
		if value, exists := e.fields[field.name]; exists {
			if err := json.Unmarshal(value, field.out); err != nil {
				return parseChatCompletion(e.data)
			}
		}
	}
	return out, nil
}

func (e eventObject) responses() (openAIResponse, error) {
	if e.legacy("response") {
		return parseOpenAIResponseEvent(e.data)
	}
	var out openAIResponse
	if value, exists := e.fields["response"]; exists {
		if err := json.Unmarshal(value, &out); err != nil {
			return parseOpenAIResponseEvent(e.data)
		}
	}
	return out, nil
}

func (e eventObject) anthropic() (anthropicResponse, error) {
	if e.legacy("id", "usage", "message") {
		return parseAnthropicResponse(e.data)
	}
	var out anthropicResponse
	for _, field := range []struct {
		name string
		out  any
	}{{"id", &out.ID}, {"usage", &out.Usage}, {"message", &out.Message}} {
		if value, exists := e.fields[field.name]; exists {
			if err := json.Unmarshal(value, field.out); err != nil {
				return parseAnthropicResponse(e.data)
			}
		}
	}
	return out, nil
}
