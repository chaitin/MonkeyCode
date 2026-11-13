package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

type ProbeInput struct {
	Message string `json:"message"`
}

func (s *Service) probeModel(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input ProbeInput
	if err := decodeModelRequest(w, r, &input); err != nil || strings.TrimSpace(input.Message) == "" || utf8.RuneCountInString(input.Message) > 4000 {
		modelError(r.Context(), w, http.StatusBadRequest, "测试消息不能为空且不超过 4000 个字符")
		return
	}
	item, err := s.repository.Get(r.Context(), chi.URLParam(r, "modelID"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		modelError(r.Context(), w, status, "模型不存在")
		return
	}
	if item.OwnershipType != "system" || (item.Kind != KindText && item.Kind != KindEmbedding) {
		modelError(r.Context(), w, http.StatusBadRequest, "仅支持测试系统大语言模型或向量模型")
		return
	}
	if item.Kind == KindEmbedding {
		result, err := s.testEmbedding(r.Context(), item, strings.TrimSpace(input.Message))
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			status := http.StatusBadGateway
			if errors.Is(err, errEmbeddingProbeTimeout) {
				status = http.StatusGatewayTimeout
			}
			modelError(r.Context(), w, status, err.Error())
			return
		}
		modelJSON(w, http.StatusOK, result)
		return
	}
	upstream, err := probeRequest(item, input.Message)
	if err != nil {
		modelError(r.Context(), w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	transport := &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 5 * time.Second,
		ResponseHeaderTimeout: time.Minute,
	}
	defer transport.CloseIdleConnections()
	if item.ProxyID != "" {
		if s.proxies == nil {
			modelError(r.Context(), w, http.StatusBadGateway, "网络代理不可用")
			return
		}
		raw, err := s.proxies.ProxyURL(ctx, item.ProxyID)
		if err != nil {
			modelError(r.Context(), w, http.StatusBadGateway, "网络代理不可用")
			return
		}
		proxyURL, err := url.Parse(raw)
		if err != nil || proxyURL.Hostname() == "" || !slices.Contains([]string{"http", "https", "socks5", "socks5h"}, proxyURL.Scheme) {
			modelError(r.Context(), w, http.StatusBadGateway, "网络代理地址无效")
			return
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(upstream.Body))
	if err != nil {
		modelError(r.Context(), w, http.StatusBadRequest, "模型地址无效")
		return
	}
	req.Header = upstream.Header
	response, err := (&http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		status, message := http.StatusBadGateway, "连接模型失败，请检查地址、协议和网络代理"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			status, message = http.StatusGatewayTimeout, "模型响应超时，请重试"
		} else if errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		modelError(r.Context(), w, status, message)
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode != http.StatusOK || err != nil {
		modelError(r.Context(), w, http.StatusBadGateway, fmt.Sprintf("模型返回 HTTP %d，请检查协议和密钥", response.StatusCode))
		return
	}
	content, valid := probeContent(item.Protocol, data)
	modelJSON(w, http.StatusOK, map[string]any{"content": content, "valid": valid})
}

type probeUpstream struct {
	URL    string
	Header http.Header
	Body   []byte
}

func probeRequest(item Model, message string) (probeUpstream, error) {
	if strings.ContainsAny(item.APIKey, "\r\n") || item.APIKey == "" {
		return probeUpstream{}, errors.New("模型密钥无效")
	}
	base, err := url.Parse(item.BaseURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" || base.User != nil {
		return probeUpstream{}, errors.New("模型地址无效")
	}
	var endpoint string
	var body any
	header := make(http.Header)
	header.Set("Accept", "application/json")
	header.Set("Content-Type", "application/json")
	switch item.Protocol {
	case ProtocolOpenAIChat:
		endpoint = "chat/completions"
		header.Set("Authorization", "Bearer "+item.APIKey)
		body = map[string]any{"model": item.ModelID, "stream": false, "messages": []map[string]string{{"role": "user", "content": message}}}
	case ProtocolOpenAIResponses:
		endpoint = "responses"
		header.Set("Authorization", "Bearer "+item.APIKey)
		body = map[string]any{"model": item.ModelID, "stream": false, "input": message}
	case ProtocolAnthropic:
		endpoint = "messages"
		header.Set("X-Api-Key", item.APIKey)
		header.Set("Anthropic-Version", "2023-06-01")
		body = map[string]any{"model": item.ModelID, "stream": false, "max_tokens": 256, "messages": []map[string]string{{"role": "user", "content": message}}}
	default:
		return probeUpstream{}, errors.New("仅支持测试大语言模型协议")
	}
	base.Path = path.Join(base.Path, endpoint)
	base.RawPath = ""
	encoded, err := json.Marshal(body)
	if err != nil {
		return probeUpstream{}, err
	}
	return probeUpstream{URL: base.String(), Header: header, Body: encoded}, nil
}

func probeContent(protocol Protocol, data []byte) (string, bool) {
	var response map[string]any
	if json.Unmarshal(data, &response) != nil {
		return "模型响应不是合法 JSON", false
	}
	switch protocol {
	case ProtocolOpenAIChat:
		choices, _ := response["choices"].([]any)
		if len(choices) == 0 {
			break
		}
		choice, _ := choices[0].(map[string]any)
		message, _ := choice["message"].(map[string]any)
		if content, ok := message["content"].(string); ok && strings.TrimSpace(content) != "" {
			return content, true
		}
	case ProtocolOpenAIResponses:
		if content, ok := response["output_text"].(string); ok && strings.TrimSpace(content) != "" {
			return content, true
		}
	case ProtocolAnthropic:
		blocks, _ := response["content"].([]any)
		var content strings.Builder
		for _, block := range blocks {
			item, _ := block.(map[string]any)
			if item["type"] == "text" {
				text, _ := item["text"].(string)
				content.WriteString(text)
			}
		}
		if strings.TrimSpace(content.String()) != "" {
			return content.String(), true
		}
	}
	return "模型响应缺少合法文本内容", false
}
