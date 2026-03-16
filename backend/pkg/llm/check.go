// Package llm 提供精简版 LLM 健康检查
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
)

// InterfaceType 定义 API 接口类型
type InterfaceType string

const (
	InterfaceOpenAIChat      InterfaceType = "openai_chat"
	InterfaceOpenAIResponses InterfaceType = "openai_responses"
	InterfaceAnthropic       InterfaceType = "anthropic"
)

// Config 健康检查配置
type Config struct {
	BaseURL       string        `json:"base_url,omitempty"`
	APIKey        string        `json:"api_key"`
	Model         string        `json:"model"`
	InterfaceType InterfaceType `json:"interface_type,omitempty"`
}

// HealthCheck 模型的健康检查
// 只验证 API 连通性、认证和模型是否存在，不校验回答内容
func HealthCheck(ctx context.Context, cfg Config) error {
	interfaceType := fillInterfaceType(cfg.Model, cfg.InterfaceType)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	switch interfaceType {
	case InterfaceAnthropic:
		return healthCheckAnthropic(ctx, cfg)
	case InterfaceOpenAIResponses:
		return healthCheckOpenAIResponses(ctx, cfg)
	default:
		return healthCheckOpenAIChat(ctx, cfg)
	}
}

func fillInterfaceType(model string, interfaceType InterfaceType) InterfaceType {
	if interfaceType != "" {
		return interfaceType
	}
	if strings.Contains(model, "codex") {
		return InterfaceOpenAIResponses
	} else if strings.Contains(model, "claude") {
		return InterfaceAnthropic
	}
	return InterfaceOpenAIChat
}

func healthCheckOpenAIChat(ctx context.Context, cfg Config) error {
	baseURL := strings.TrimSuffix(cfg.BaseURL, "/")

	body := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"max_tokens": 1,
	}

	respBody, err := doRequest(ctx, baseURL+"/chat/completions", cfg.APIKey, "bearer", body)
	if err != nil {
		return err
	}

	var resp struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}
	if resp.Error != nil {
		return fmt.Errorf("API error: %s", resp.Error.Message)
	}
	return nil
}

func healthCheckOpenAIResponses(ctx context.Context, cfg Config) error {
	baseURL := strings.TrimSuffix(cfg.BaseURL, "/")

	body := map[string]any{
		"model": cfg.Model,
		"input": []map[string]string{
			{"role": "user", "content": "hi"},
		},
	}

	respBody, err := doRequest(ctx, baseURL+"/responses", cfg.APIKey, "bearer", body)
	if err != nil {
		return err
	}

	var resp struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}
	if resp.Error != nil {
		return fmt.Errorf("API error: %s", resp.Error.Message)
	}
	return nil
}

func healthCheckAnthropic(ctx context.Context, cfg Config) error {
	baseURL := strings.TrimSuffix(cfg.BaseURL, "/v1")
	baseURL = strings.TrimSuffix(baseURL, "/")

	body := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"max_tokens": 1,
	}

	respBody, err := doRequest(ctx, baseURL+"/v1/messages", cfg.APIKey, "x-api-key", body)
	if err != nil {
		return err
	}

	var resp struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}
	if resp.Error != nil {
		return fmt.Errorf("API error: %s", resp.Error.Message)
	}
	return nil
}

func doRequest(ctx context.Context, url, apiKey, authType string, body any) ([]byte, error) {
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if authType == "x-api-key" {
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
