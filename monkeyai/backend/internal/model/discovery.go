package model

import (
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
)

type DiscoverInput struct {
	BaseURL         string   `json:"base_url"`
	Protocol        Protocol `json:"protocol"`
	APIKey          string   `json:"api_key"`
	ModelResourceID string   `json:"model_resource_id,omitempty"`
	ProxyID         string   `json:"proxy_id,omitempty"`
}

type DiscoveredModel struct {
	ID string `json:"id"`
}

var errDiscoveryUpstream = errors.New("获取上游模型列表失败")

func (s *Service) discoverModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input DiscoverInput
	if err := decodeModelRequest(w, r, &input); err != nil {
		modelError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	models, err := s.DiscoverModels(r.Context(), input)
	if err != nil {
		status, message := http.StatusBadRequest, err.Error()
		if errors.Is(err, errDiscoveryUpstream) {
			status = http.StatusBadGateway
		} else if errors.Is(err, context.DeadlineExceeded) {
			status, message = http.StatusGatewayTimeout, "获取模型列表超时，请重试"
		} else if errors.Is(err, context.Canceled) {
			return
		}
		modelError(w, status, message)
		return
	}
	modelJSON(w, http.StatusOK, map[string]any{"models": models})
}

// DiscoverModels uses administrator-supplied credentials on the server only.
// Redirects are disabled so credentials cannot be forwarded to a second host.
func (s *Service) DiscoverModels(ctx context.Context, input DiscoverInput) ([]DiscoveredModel, error) {
	if !slices.Contains([]Protocol{ProtocolOpenAIChat, ProtocolOpenAIResponses, ProtocolAnthropic}, input.Protocol) {
		return nil, errors.New("仅支持查询大语言模型协议")
	}
	upstream, err := url.Parse(strings.TrimSpace(input.BaseURL))
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") || upstream.Hostname() == "" || upstream.User != nil || upstream.Fragment != "" {
		return nil, errors.New("base_url 必须是有效的 HTTP(S) 地址")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	key := strings.TrimSpace(input.APIKey)
	if key == "" && input.ModelResourceID != "" {
		stored, err := s.repository.Get(ctx, input.ModelResourceID)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err != nil || stored.OwnershipType != "system" || stored.Kind != KindText {
			return nil, errors.New("无法读取该系统大语言模型的已保存密钥")
		}
		key = stored.APIKey
	}
	if key == "" || len(key) > 16<<10 || strings.ContainsAny(key, "\r\n") {
		return nil, errors.New("api_key 不能为空且必须有效")
	}
	transport := &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	defer transport.CloseIdleConnections()
	if input.ProxyID != "" {
		if s.proxies == nil {
			return nil, errors.New("网络代理不可用")
		}
		raw, err := s.proxies.ProxyURL(ctx, input.ProxyID)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, errors.New("网络代理不可用")
		}
		proxyURL, err := url.Parse(raw)
		if err != nil || proxyURL.Hostname() == "" || !slices.Contains([]string{"http", "https", "socks5", "socks5h"}, proxyURL.Scheme) {
			return nil, errors.New("网络代理地址无效")
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	upstream.Path = path.Join(upstream.Path, "models")
	upstream.RawPath = ""
	if input.Protocol == ProtocolAnthropic {
		query := upstream.Query()
		query.Set("limit", "1000")
		upstream.RawQuery = query.Encode()
	}
	models := make([]DiscoveredModel, 0)
	seen := make(map[string]bool)
	cursors := make(map[string]bool)
	remaining := int64(2 << 20)
	for page := 0; page < 20; page++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
		if err != nil {
			return nil, errors.New("base_url 无效")
		}
		req.Header.Set("Accept", "application/json")
		if input.Protocol == ProtocolAnthropic {
			req.Header.Set("X-Api-Key", key)
			req.Header.Set("Anthropic-Version", "2023-06-01")
		} else {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		response, err := client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, fmt.Errorf("%w，请检查 Base URL 和网络代理", errDiscoveryUpstream)
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, fmt.Errorf("%w：上游返回 HTTP %d，请检查协议和密钥", errDiscoveryUpstream, response.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, remaining+1))
		response.Body.Close()
		if err != nil || int64(len(data)) > remaining {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, fmt.Errorf("%w：响应无法读取或超过大小限制", errDiscoveryUpstream)
		}
		remaining -= int64(len(data))
		var result struct {
			Data    []DiscoveredModel `json:"data"`
			HasMore bool              `json:"has_more"`
			LastID  string            `json:"last_id"`
		}
		if err := json.Unmarshal(data, &result); err != nil || result.Data == nil {
			return nil, fmt.Errorf("%w：响应格式无效", errDiscoveryUpstream)
		}
		for _, item := range result.Data {
			item.ID = strings.TrimSpace(item.ID)
			if item.ID == "" || seen[item.ID] {
				continue
			}
			if len(item.ID) > 512 || len(models) >= 2000 {
				return nil, fmt.Errorf("%w：模型列表超过大小限制", errDiscoveryUpstream)
			}
			seen[item.ID] = true
			models = append(models, item)
		}
		if !result.HasMore {
			slices.SortFunc(models, func(a, b DiscoveredModel) int { return strings.Compare(a.ID, b.ID) })
			return models, nil
		}
		if result.LastID == "" || cursors[result.LastID] {
			return nil, fmt.Errorf("%w：分页响应无效", errDiscoveryUpstream)
		}
		cursors[result.LastID] = true
		query := upstream.Query()
		cursorKey := "after"
		if input.Protocol == ProtocolAnthropic {
			cursorKey = "after_id"
		}
		query.Set(cursorKey, result.LastID)
		upstream.RawQuery = query.Encode()
	}
	return nil, fmt.Errorf("%w：分页超过限制", errDiscoveryUpstream)
}
