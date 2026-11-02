package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
		modelError(w, http.StatusBadRequest, "测试消息不能为空且不超过 4000 个字符")
		return
	}
	item, err := s.repository.Get(r.Context(), chi.URLParam(r, "modelID"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		modelError(w, status, "模型不存在")
		return
	}
	if item.OwnershipType != "system" || item.Kind != KindText {
		modelError(w, http.StatusBadRequest, "仅支持测试系统大语言模型")
		return
	}
	upstream, err := probeRequest(item, input.Message)
	if err != nil {
		modelError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	transport := &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 5 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
	}
	defer transport.CloseIdleConnections()
	if item.ProxyID != "" {
		if s.proxies == nil {
			modelError(w, http.StatusBadGateway, "网络代理不可用")
			return
		}
		raw, err := s.proxies.ProxyURL(ctx, item.ProxyID)
		if err != nil {
			modelError(w, http.StatusBadGateway, "网络代理不可用")
			return
		}
		proxyURL, err := url.Parse(raw)
		if err != nil || proxyURL.Hostname() == "" || !slices.Contains([]string{"http", "https", "socks5", "socks5h"}, proxyURL.Scheme) {
			modelError(w, http.StatusBadGateway, "网络代理地址无效")
			return
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(upstream.Body))
	if err != nil {
		modelError(w, http.StatusBadRequest, "模型地址无效")
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
		modelError(w, status, message)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		modelError(w, http.StatusBadGateway, fmt.Sprintf("模型返回 HTTP %d，请检查协议和密钥", response.StatusCode))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, err := response.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
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
	header.Set("Accept", "text/event-stream")
	header.Set("Content-Type", "application/json")
	switch item.Protocol {
	case ProtocolOpenAIChat:
		endpoint = "chat/completions"
		header.Set("Authorization", "Bearer "+item.APIKey)
		body = map[string]any{"model": item.ModelID, "stream": true, "messages": []map[string]string{{"role": "user", "content": message}}}
	case ProtocolOpenAIResponses:
		endpoint = "responses"
		header.Set("Authorization", "Bearer "+item.APIKey)
		body = map[string]any{"model": item.ModelID, "stream": true, "input": message}
	case ProtocolAnthropic:
		endpoint = "messages"
		header.Set("X-Api-Key", item.APIKey)
		header.Set("Anthropic-Version", "2023-06-01")
		body = map[string]any{"model": item.ModelID, "stream": true, "max_tokens": 256, "messages": []map[string]string{{"role": "user", "content": message}}}
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
