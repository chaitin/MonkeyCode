package imagegen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

const maxUpstreamResponse = 64 << 20

func Call(ctx context.Context, client *http.Client, target proxy.Target, endpoint string, payload any) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	return CallBody(ctx, client, target, endpoint, body, "application/json")
}

func CallBody(ctx context.Context, client *http.Client, target proxy.Target, endpoint string, body []byte, contentType string) ([]byte, int, error) {
	base, err := url.Parse(target.BaseURL)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Hostname() == "" || base.User != nil || base.Fragment != "" {
		return nil, 0, errors.New("生图上游地址无效")
	}
	if len(body) > maxUpstreamResponse {
		return nil, 0, errors.New("生图上游请求过大")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimLeft(endpoint, "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Authorization", "Bearer "+target.APIKey)
	if client == nil {
		return nil, 0, errors.New("生图上游 HTTP 客户端未配置")
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := clientCopy.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, response.StatusCode, nil
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxUpstreamResponse+1))
	if err != nil {
		return nil, 0, err
	}
	if len(content) > maxUpstreamResponse {
		return nil, 0, errors.New("生图上游响应过大")
	}
	return content, response.StatusCode, nil
}

func DecodeImage(encoded string) ([]byte, error) {
	if len(encoded) == 0 || len(encoded) > (maxOutputBytes+2)/3*4+4 {
		return nil, errors.New("生图结果大小无效")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(content) == 0 || len(content) > maxOutputBytes {
		return nil, errors.New("生图 Base64 结果无效")
	}
	return content, nil
}
