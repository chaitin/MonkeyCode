package proxy

import (
	"encoding/json"
	"encoding/json/jsontext"
	jsonv2 "encoding/json/v2"
	"errors"
	"fmt"
)

type estimateFunction struct {
	Name      any `json:"name"`
	Arguments any `json:"arguments"`
}

type estimateChoice struct {
	Index *json.Number `json:"index"`
	Delta *struct {
		Content          any               `json:"content"`
		ReasoningContent any               `json:"reasoning_content"`
		Reasoning        any               `json:"reasoning"`
		Refusal          any               `json:"refusal"`
		FunctionCall     *estimateFunction `json:"function_call"`
		ToolCalls        []struct {
			Index    *json.Number      `json:"index"`
			Function *estimateFunction `json:"function"`
		} `json:"tool_calls"`
		Audio any `json:"audio"`
	} `json:"delta"`
	FinishReason any `json:"finish_reason"`
}

var choiceOptions = jsonv2.JoinOptions(json.DefaultOptionsV1(),
	jsonv2.MatchCaseInsensitiveNames(false), jsontext.AllowDuplicateNames(false))

func (e eventObject) choices() ([]estimateChoice, error) {
	if e.err != nil || e.duplicate || e.fields == nil {
		return nil, errors.ErrUnsupported
	}
	value, exists := e.fields["choices"]
	if !exists {
		return nil, nil
	}
	var choices []estimateChoice
	err := jsonv2.Unmarshal(value, &choices, choiceOptions)
	return choices, err
}

func (e *tokenEstimate) chatChoices(choices []estimateChoice) {
	for _, choice := range choices {
		delta := choice.Delta
		if delta == nil {
			continue
		}
		e.seen = true
		var index any
		if choice.Index != nil {
			index = *choice.Index
		}
		key := fmt.Sprintf("choice/%v", index)
		for _, part := range []struct {
			field string
			value any
		}{{"content", delta.Content}, {"reasoning_content", delta.ReasoningContent},
			{"reasoning", delta.Reasoning}, {"refusal", delta.Refusal}} {
			if text, ok := part.value.(string); ok {
				e.append(key+"/"+part.field, text)
			} else if part.value != nil {
				e.supported = false
			}
		}
		if call := delta.FunctionCall; call != nil {
			if name, ok := call.Name.(string); ok {
				e.append(key+"/function/name", name)
			}
			if arguments, ok := call.Arguments.(string); ok {
				e.append(key+"/function/arguments", arguments)
			}
		}
		for _, call := range delta.ToolCalls {
			if call.Function == nil {
				e.supported = false
				continue
			}
			var index any
			if call.Index != nil {
				index = *call.Index
			}
			prefix := fmt.Sprintf("%s/tool/%v", key, index)
			if name, ok := call.Function.Name.(string); ok {
				e.append(prefix+"/name", name)
			}
			if arguments, ok := call.Function.Arguments.(string); ok {
				e.append(prefix+"/arguments", arguments)
			}
		}
		if delta.Audio != nil {
			e.supported = false
		}
		if reason, ok := choice.FinishReason.(string); ok && reason != "" {
			e.complete = true
		}
	}
}
