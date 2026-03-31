package oauth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// fetchWithProxy 使用代理重试机制发送 HTTP 请求
func fetchWithProxy[T any](method, addr string, headers map[string]string, proxies ...string) (*T, error) {
	return fetchWithProxyAndBody[T](method, addr, headers, nil, proxies...)
}

// fetchWithProxyAndBody 使用代理重试机制发送 HTTP 请求（支持请求体）
func fetchWithProxyAndBody[T any](method, addr string, headers map[string]string, body io.Reader, proxies ...string) (*T, error) {
	// 把 body 内容缓存起来，避免被多次读取后为空
	var bodyBytes []byte
	if body != nil {
		bodyBytes, _ = io.ReadAll(body)
	}

	var err error
	var result *T

	if len(proxies) > 0 {
		for _, proxy := range proxies {
			var reader io.Reader
			if bodyBytes != nil {
				reader = bytes.NewReader(bodyBytes)
			}
			result, err = doRequest[T](method, addr, headers, reader, proxy)
			if err == nil {
				return result, nil
			}
		}
	} else {
		var reader io.Reader
		if bodyBytes != nil {
			reader = bytes.NewReader(bodyBytes)
		}
		result, err = doRequest[T](method, addr, headers, reader, "")
		if err == nil {
			return result, nil
		}
	}

	return nil, err
}

// doRequest 执行 HTTP 请求
func doRequest[T any](method, addr string, headers map[string]string, body io.Reader, proxyAddr string) (*T, error) {
	req, err := http.NewRequest(method, addr, body)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	if proxyAddr != "" {
		proxyURL, err := url.Parse(proxyAddr)
		if err != nil {
			return nil, err
		}
		client.Transport = &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status code: %d, body: %s", resp.StatusCode, string(respBody))
	}

	var result T
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w, body: %s", err, string(respBody))
	}
	return &result, nil
}
