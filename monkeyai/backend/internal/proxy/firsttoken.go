package proxy

import "encoding/json"

// firstOutputEvent ignores headers, stream setup and usage-only events.
func firstOutputEvent(path string, event sseEvent) bool {
	switch path {
	case "/v1/chat/completions":
		if event.Type != "" && event.Type != "message" {
			return false
		}
		var chunk struct {
			Choices []struct {
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
			} `json:"choices"`
		}
		if json.Unmarshal(event.Data, &chunk) != nil {
			return false
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" || choice.Delta.FunctionCall.Arguments != "" {
				return true
			}
			for _, tool := range choice.Delta.ToolCalls {
				if tool.Function.Arguments != "" {
					return true
				}
			}
		}
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
			Delta struct {
				Text        string `json:"text"`
				Thinking    string `json:"thinking"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
		}
		return json.Unmarshal(event.Data, &chunk) == nil &&
			(chunk.Delta.Text != "" || chunk.Delta.Thinking != "" || chunk.Delta.PartialJSON != "")
	}
	return false
}
