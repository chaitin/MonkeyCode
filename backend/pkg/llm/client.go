// Package llm 提供统一的 LLM 客户端，支持 OpenAI Chat、OpenAI Responses 和 Anthropic 三种 API 格式
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/sashabaranov/go-openai"
)

// WithInterfaceType 设置接口类型
func WithInterfaceType(t InterfaceType) ClientOption {
	return func(c *Client) {
		c.interfaceType = t
	}
}

// NewClient 创建新的 LLM 客户端
func NewClient(cfg Config, opts ...ClientOption) *Client {
	interfaceType := cfg.InterfaceType
	if interfaceType == "" {
		interfaceType = InterfaceOpenAIChat
	}

	client := &Client{
		baseURL:       cfg.BaseURL,
		apiKey:        cfg.APIKey,
		model:         cfg.Model,
		interfaceType: interfaceType,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}

	for _, opt := range opts {
		opt(client)
	}

	if client.interfaceType == InterfaceOpenAIChat && cfg.APIKey != "" {
		openaiConfig := openai.DefaultConfig(cfg.APIKey)
		if cfg.BaseURL != "" {
			openaiConfig.BaseURL = cfg.BaseURL
		}
		client.openaiClient = openai.NewClientWithConfig(openaiConfig)
	} else if client.interfaceType == InterfaceAnthropic && cfg.APIKey != "" {
		client.anthropicClient = newAnthropicClient(cfg, client.httpClient)
	}

	return client
}

// Chat 发送聊天请求（统一入口）
func (c *Client) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	if c.apiKey == "" {
		return &ChatResponse{
			Content: "这是一个模拟的AI响应。请设置API Key以使用真实的AI服务。",
			Usage:   Usage{},
		}, nil
	}

	if req.Model == "" {
		req.Model = c.model
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = 1000
	}

	interfaceType := c.interfaceType
	if req.InterfaceType != "" {
		interfaceType = req.InterfaceType
	}

	if req.Temperature == 0 && interfaceType != InterfaceOpenAIResponses {
		req.Temperature = 0.7
	}

	switch interfaceType {
	case InterfaceOpenAIChat:
		return c.chatOpenAI(ctx, req)
	case InterfaceOpenAIResponses:
		return c.chatOpenAIResponses(ctx, req)
	case InterfaceAnthropic:
		return c.chatAnthropic(ctx, req)
	default:
		return nil, fmt.Errorf("unsupported interface type: %s", interfaceType)
	}
}

func (c *Client) chatOpenAI(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	if c.openaiClient == nil {
		openaiConfig := openai.DefaultConfig(c.apiKey)
		if c.baseURL != "" {
			openaiConfig.BaseURL = c.baseURL
		}
		c.openaiClient = openai.NewClientWithConfig(openaiConfig)
	}

	messages := make([]openai.ChatCompletionMessage, 0, len(req.Messages)+1)

	if req.System != "" {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    "system",
			Content: req.System,
		})
	}

	for _, msg := range req.Messages {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	resp, err := c.openaiClient.CreateChatCompletion(
		ctx,
		openai.ChatCompletionRequest{
			Model:       req.Model,
			Messages:    messages,
			MaxTokens:   req.MaxTokens,
			Temperature: req.Temperature,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("OpenAI Chat API调用失败: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("OpenAI Chat API返回空响应")
	}

	return &ChatResponse{
		Content: resp.Choices[0].Message.Content,
		Usage: Usage{
			PromptTokens:     resp.Usage.PromptTokens,
			CompletionTokens: resp.Usage.CompletionTokens,
			TotalTokens:      resp.Usage.TotalTokens,
		},
	}, nil
}

func (c *Client) chatOpenAIResponses(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	baseURL := c.baseURL
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	url := strings.TrimSuffix(baseURL, "/") + "/responses"

	inputs := make([]openAIResponsesInput, 0, len(req.Messages)+1)

	if req.System != "" {
		inputs = append(inputs, openAIResponsesInput{
			Role:    "system",
			Content: req.System,
		})
	}

	for _, msg := range req.Messages {
		inputs = append(inputs, openAIResponsesInput(msg))
	}

	requestBody := openAIResponsesRequest{
		Model:          req.Model,
		Input:          inputs,
		MaxOutputToken: req.MaxTokens,
		Temperature:    req.Temperature,
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("OpenAI Responses API调用失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OpenAI Responses API返回错误: %s, body: %s", resp.Status, string(respBody))
	}

	var apiResp openAIResponsesResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if apiResp.Error != nil {
		return nil, fmt.Errorf("OpenAI Responses API错误: %s", apiResp.Error.Message)
	}

	var content strings.Builder
	for _, output := range apiResp.Output {
		if output.Type == "message" {
			for _, c := range output.Content {
				if c.Type == "output_text" {
					content.WriteString(c.Text)
				}
			}
		}
	}

	return &ChatResponse{
		Content: content.String(),
		Usage: Usage{
			PromptTokens:     apiResp.Usage.InputTokens,
			CompletionTokens: apiResp.Usage.OutputTokens,
			TotalTokens:      apiResp.Usage.TotalTokens,
		},
	}, nil
}

func (c *Client) chatAnthropic(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	if c.anthropicClient == nil {
		c.anthropicClient = newAnthropicClient(Config{
			BaseURL: c.baseURL,
			APIKey:  c.apiKey,
			Model:   c.model,
		}, c.httpClient)
	}

	messages := make([]anthropic.MessageParam, 0, len(req.Messages))
	system := make([]anthropic.TextBlockParam, 0, 1)
	if req.System != "" {
		system = append(system, anthropic.TextBlockParam{Text: req.System})
	}

	for _, msg := range req.Messages {
		switch msg.Role {
		case "system":
			if msg.Content != "" {
				system = append(system, anthropic.TextBlockParam{Text: msg.Content})
			}
		case "user":
			messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock(msg.Content)))
		case "assistant":
			messages = append(messages, anthropic.NewAssistantMessage(anthropic.NewTextBlock(msg.Content)))
		default:
			messages = append(messages, anthropic.MessageParam{
				Role:    anthropic.MessageParamRole(msg.Role),
				Content: []anthropic.ContentBlockParamUnion{anthropic.NewTextBlock(msg.Content)},
			})
		}
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		Messages:  messages,
		MaxTokens: int64(req.MaxTokens),
	}
	if req.Temperature != 0 {
		params.Temperature = anthropic.Float(float64(req.Temperature))
	}
	if len(system) > 0 {
		params.System = system
	}

	resp, err := c.anthropicClient.Messages.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("anthropic API调用失败: %w", err)
	}

	var content strings.Builder
	for _, block := range resp.Content {
		if block.Type == "text" {
			content.WriteString(block.Text)
		}
	}

	return &ChatResponse{
		Content: content.String(),
		Usage: Usage{
			PromptTokens:     int(resp.Usage.InputTokens),
			CompletionTokens: int(resp.Usage.OutputTokens),
			TotalTokens:      int(resp.Usage.InputTokens + resp.Usage.OutputTokens),
		},
	}, nil
}

// ChatNoException 发送聊天请求，出错时返回错误信息而不是抛出异常
func (c *Client) ChatNoException(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	resp, err := c.Chat(ctx, req)
	if err != nil {
		return &ChatResponse{
			Content: "无法处理消息，请稍后重试。（错误信息：" + err.Error() + "）",
		}, nil
	}
	return resp, nil
}

func newAnthropicClient(cfg Config, httpClient *http.Client) *anthropic.Client {
	opts := []option.RequestOption{
		option.WithoutEnvironmentDefaults(),
		option.WithAPIKey(cfg.APIKey),
	}
	if httpClient != nil {
		opts = append(opts, option.WithHTTPClient(httpClient))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(normalizeAnthropicBaseURL(cfg.BaseURL)))
	}
	client := anthropic.NewClient(opts...)
	return &client
}

func normalizeAnthropicBaseURL(baseURL string) string {
	baseURL = strings.TrimSuffix(baseURL, "/")
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	return strings.TrimSuffix(baseURL, "/")
}
