package proxy

import "encoding/json"

type firstChatChoice struct {
	Delta struct {
		Content   string `json:"content"`
		ToolCalls []struct {
			Function struct {
				Arguments string `json:"arguments"`
			} `json:"function"`
		} `json:"tool_calls"`
		FunctionCall struct {
			Arguments string `json:"arguments"`
		} `json:"function_call"`
	} `json:"delta"`
}

type firstMessageDelta struct {
	Text        string `json:"text"`
	Thinking    string `json:"thinking"`
	PartialJSON string `json:"partial_json"`
}

func chatOutput(choices []firstChatChoice) bool {
	for _, choice := range choices {
		if choice.Delta.Content != "" || choice.Delta.FunctionCall.Arguments != "" {
			return true
		}
		for _, tool := range choice.Delta.ToolCalls {
			if tool.Function.Arguments != "" {
				return true
			}
		}
	}
	return false
}

// firstOutputEvent ignores headers, stream setup and usage-only events.
func firstOutputEvent(path string, event sseEvent) bool {
	switch path {
	case "/v1/chat/completions":
		if event.Type != "" && event.Type != "message" {
			return false
		}
		var chunk struct {
			Choices []firstChatChoice `json:"choices"`
		}
		return json.Unmarshal(event.Data, &chunk) == nil && chatOutput(chunk.Choices)
	case "/v1/responses":
		if event.Type != "response.output_text.delta" && event.Type != "response.function_call_arguments.delta" {
			return false
		}
		var chunk struct {
			Delta string `json:"delta"`
		}
		return json.Unmarshal(event.Data, &chunk) == nil && chunk.Delta != ""
	case "/v1/messages":
		if event.Type != "content_block_delta" {
			return false
		}
		var chunk struct {
			Delta firstMessageDelta `json:"delta"`
		}
		return json.Unmarshal(event.Data, &chunk) == nil &&
			(chunk.Delta.Text != "" || chunk.Delta.Thinking != "" || chunk.Delta.PartialJSON != "")
	}
	return false
}

func (e eventObject) firstOutput(path string, event sseEvent) bool {
	if e.err != nil {
		return false
	}
	switch path {
	case "/v1/chat/completions":
		if event.Type != "" && event.Type != "message" {
			return false
		}
		if e.legacy("choices") {
			return firstOutputEvent(path, event)
		}
		var choices []firstChatChoice
		return json.Unmarshal(e.fields["choices"], &choices) == nil && chatOutput(choices)
	case "/v1/responses":
		if event.Type != "response.output_text.delta" && event.Type != "response.function_call_arguments.delta" {
			return false
		}
		if e.legacy("delta") {
			return firstOutputEvent(path, event)
		}
		var delta string
		return json.Unmarshal(e.fields["delta"], &delta) == nil && delta != ""
	case "/v1/messages":
		if event.Type != "content_block_delta" {
			return false
		}
		if e.legacy("delta") {
			return firstOutputEvent(path, event)
		}
		var delta firstMessageDelta
		return json.Unmarshal(e.fields["delta"], &delta) == nil &&
			(delta.Text != "" || delta.Thinking != "" || delta.PartialJSON != "")
	}
	return false
}
