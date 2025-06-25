package promptparser

import (
	"fmt"
	"regexp"
)

type PromptParser interface {
	Parse(prompt string) (*Info, error)
}

type Info struct {
	Prompt          string
	ProgramLanguage string
	WorkMode        string
}

type Kind int

const (
	KindNormal Kind = iota + 1
	KindTask
)

func New(kind Kind) PromptParser {
	switch kind {
	case KindNormal:
		return &NormalParser{}
	case KindTask:
		return &TaskParse{}
	default:
		return nil
	}
}

type NormalParser struct {
}

// Parse implements PromptParser.
func (n *NormalParser) Parse(prompt string) (*Info, error) {
	// re := regexp.MustCompile(`You are a code completion assistant for (\w+). Complete the code, don't explain it. Only return code that should come next.(.*)`)
	re := regexp.MustCompile(`You are a code completion assistant for (\w+). Complete the code naturally, providing complete and meaningful code blocks when appropriate. Return only the code that should come next, without explanations.(.*)`)
	match := re.FindStringSubmatch(prompt)
	if len(match) < 3 {
		return nil, fmt.Errorf("invalid prompt")
	}
	return &Info{
		ProgramLanguage: match[1],
		Prompt:          match[2],
	}, nil
}

type TaskParse struct {
}

func (m *TaskParse) Parse(prompt string) (*Info, error) {
	re := regexp.MustCompile(`<task>(.*)</task><file_content path="(.*)">(.*)</file_content><environment_details>(.*)</environment_details>`)
	match := re.FindStringSubmatch(prompt)
	if len(match) < 5 {
		return nil, fmt.Errorf("invalid prompt")
	}
	return &Info{
		Prompt: match[1],
	}, nil
}
