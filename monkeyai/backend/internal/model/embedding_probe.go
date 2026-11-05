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
)

const embeddingProbeResponseLimit = 16 << 20

var errEmbeddingProbeTimeout = errors.New("上游响应超时")

type embeddingProbeResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Usage struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

type embeddingProbeResult struct {
	Dimension           int       `json:"dimension"`
	ConfiguredDimension int       `json:"configured_dimension"`
	DimensionMatches    bool      `json:"dimension_matches"`
	VectorPreview       []float64 `json:"vector_preview"`
	PromptTokens        int       `json:"prompt_tokens"`
	TotalTokens         int       `json:"total_tokens"`
}

func (s *Service) applyEmbeddingDimension(ctx context.Context, item *Model) error {
	if item.Kind != KindEmbedding {
		return nil
	}
	dimension, err := s.resolveEmbeddingDimension(ctx, *item)
	if err != nil {
		return fmt.Errorf("检测向量维度失败: %w", err)
	}
	if err := validateEmbeddingDimension(dimension); err != nil {
		return err
	}
	item.EmbeddingConfig = &EmbeddingConfig{Dimension: dimension}
	return nil
}

func (s *Service) resolveEmbeddingDimension(ctx context.Context, item Model) (int, error) {
	if s.embeddingDimensionProbe != nil {
		return s.embeddingDimensionProbe(ctx, item)
	}
	return s.probeEmbeddingDimension(ctx, item)
}

func (s *Service) probeEmbeddingDimension(ctx context.Context, item Model) (int, error) {
	payload, err := s.requestEmbedding(ctx, item, "MonkeyAI embedding dimension probe", 15*time.Second)
	if err != nil {
		return 0, err
	}
	return embeddingDimension(payload)
}

func (s *Service) testEmbedding(ctx context.Context, item Model, input string) (embeddingProbeResult, error) {
	payload, err := s.requestEmbedding(ctx, item, input, 30*time.Second)
	if err != nil {
		return embeddingProbeResult{}, err
	}
	dimension, err := embeddingDimension(payload)
	if err != nil {
		return embeddingProbeResult{}, err
	}
	configured := 0
	if item.EmbeddingConfig != nil {
		configured = item.EmbeddingConfig.Dimension
	}
	previewLength := min(8, len(payload.Data[0].Embedding))
	return embeddingProbeResult{
		Dimension:           dimension,
		ConfiguredDimension: configured,
		DimensionMatches:    configured == dimension,
		VectorPreview:       append([]float64(nil), payload.Data[0].Embedding[:previewLength]...),
		PromptTokens:        payload.Usage.PromptTokens,
		TotalTokens:         payload.Usage.TotalTokens,
	}, nil
}

func embeddingDimension(payload embeddingProbeResponse) (int, error) {
	if len(payload.Data) == 0 || len(payload.Data[0].Embedding) == 0 {
		return 0, errors.New("上游响应缺少有效的 embedding 向量")
	}
	dimension := len(payload.Data[0].Embedding)
	for _, item := range payload.Data {
		if len(item.Embedding) != dimension {
			return 0, errors.New("上游返回了维度不一致的 embedding 向量")
		}
	}
	if err := validateEmbeddingDimension(dimension); err != nil {
		return 0, err
	}
	return dimension, nil
}

func (s *Service) requestEmbedding(ctx context.Context, item Model, input string, timeout time.Duration) (embeddingProbeResponse, error) {
	if item.APIKey == "" || strings.ContainsAny(item.APIKey, "\r\n") {
		return embeddingProbeResponse{}, errors.New("模型密钥无效")
	}
	base, err := url.Parse(item.BaseURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" || base.User != nil || base.Fragment != "" {
		return embeddingProbeResponse{}, errors.New("模型地址无效")
	}
	base.Path = path.Join(base.Path, "embeddings")
	base.RawPath = ""
	requestBody, err := json.Marshal(map[string]any{
		"model": item.ModelID,
		"input": input,
	})
	if err != nil {
		return embeddingProbeResponse{}, errors.New("无法构造向量探测请求")
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	transport := &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	defer transport.CloseIdleConnections()
	if item.ProxyID != "" {
		if s.proxies == nil {
			return embeddingProbeResponse{}, errors.New("网络代理不可用")
		}
		raw, err := s.proxies.ProxyURL(ctx, item.ProxyID)
		if err != nil {
			if ctx.Err() != nil {
				return embeddingProbeResponse{}, ctx.Err()
			}
			return embeddingProbeResponse{}, errors.New("网络代理不可用")
		}
		proxyURL, err := url.Parse(raw)
		if err != nil || proxyURL.Hostname() == "" || !slices.Contains([]string{"http", "https", "socks5", "socks5h"}, proxyURL.Scheme) {
			return embeddingProbeResponse{}, errors.New("网络代理地址无效")
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), bytes.NewReader(requestBody))
	if err != nil {
		return embeddingProbeResponse{}, errors.New("模型地址无效")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+item.APIKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}).Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return embeddingProbeResponse{}, errEmbeddingProbeTimeout
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return embeddingProbeResponse{}, ctx.Err()
		}
		return embeddingProbeResponse{}, errors.New("连接上游失败，请检查地址、密钥和网络代理")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return embeddingProbeResponse{}, fmt.Errorf("上游返回 HTTP %d，请检查模型、地址和密钥", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, embeddingProbeResponseLimit+1))
	if err != nil {
		return embeddingProbeResponse{}, errors.New("读取上游响应失败")
	}
	if len(data) > embeddingProbeResponseLimit {
		return embeddingProbeResponse{}, errors.New("上游响应超过大小限制")
	}
	var payload embeddingProbeResponse
	if err := json.Unmarshal(data, &payload); err != nil {
		return embeddingProbeResponse{}, errors.New("上游响应缺少有效的 embedding 向量")
	}
	return payload, nil
}
