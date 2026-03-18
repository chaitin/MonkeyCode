package llm

import (
	"net/http"

	"github.com/sashabaranov/go-openai"
)

// Client LLM 客户端
type Client struct {
	openaiClient  *openai.Client
	httpClient    *http.Client
	baseURL       string
	apiKey        string
	model         string
	interfaceType InterfaceType
}

// ClientOption 客户端配置选项
type ClientOption func(*Client)

// ChatRequest 聊天请求
type ChatRequest struct {
	Messages      []Message     `json:"messages"`
	Model         string        `json:"model,omitempty"`
	MaxTokens     int           `json:"max_tokens,omitempty"`
	Temperature   float32       `json:"temperature,omitempty"`
	System        string        `json:"system,omitempty"`
	InterfaceType InterfaceType `json:"interface_type,omitempty"`
}

// Message 聊天消息
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse 聊天响应
type ChatResponse struct {
	Content string `json:"content"`
	Usage   Usage  `json:"usage"`
}

// Usage token 使用情况
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ==================== OpenAI Responses API 类型 ====================

type openAIResponsesRequest struct {
	Model          string                 `json:"model"`
	Input          []openAIResponsesInput `json:"input"`
	MaxOutputToken int                    `json:"max_output_tokens,omitempty"`
	Temperature    float32                `json:"temperature,omitempty"`
}

type openAIResponsesInput struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResponsesResponse struct {
	ID     string                  `json:"id"`
	Output []openAIResponsesOutput `json:"output"`
	Usage  openAIResponsesUsage    `json:"usage"`
	Error  *openAIError            `json:"error,omitempty"`
}

type openAIResponsesOutput struct {
	Type    string                   `json:"type"`
	Content []openAIResponsesContent `json:"content,omitempty"`
}

type openAIResponsesContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type openAIResponsesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

type openAIError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

// ==================== Anthropic API 类型 ====================

type anthropicRequest struct {
	Model       string             `json:"model"`
	Messages    []anthropicMessage `json:"messages"`
	MaxTokens   int                `json:"max_tokens"`
	Temperature float32            `json:"temperature,omitempty"`
	System      string             `json:"system,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	ID      string             `json:"id"`
	Type    string             `json:"type"`
	Role    string             `json:"role"`
	Content []anthropicContent `json:"content"`
	Usage   anthropicUsage     `json:"usage"`
	Error   *anthropicError    `json:"error,omitempty"`
}

type anthropicContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}
