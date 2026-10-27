package videogen

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const (
	maxProviderResponse   = 1 << 20
	outputDownloadTimeout = 10 * time.Minute
)

type diagnosticError struct {
	code    string
	message string
}

func (e diagnosticError) Error() string          { return e.message }
func (e diagnosticError) DiagnosticCode() string { return e.code }

var (
	errUpstreamURL      = diagnosticError{code: "upstream_url_invalid", message: "视频上游地址必须是无查询参数的 HTTP(S) URL"}
	errUpstreamEndpoint = diagnosticError{code: "upstream_url_invalid", message: "视频上游接口地址无效"}
	errResolveFailed    = diagnosticError{code: "upstream_resolve_failed", message: "上游地址无法解析"}
	errAddressBlocked   = diagnosticError{code: "upstream_address_blocked", message: "上游地址不在公网范围"}
	errProxyUnavailable = diagnosticError{code: "proxy_unavailable", message: "系统代理不可用"}
)

func externalIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.Zone() != "" {
		return false
	}
	for _, block := range []string{"0.0.0.0/8", "100.64.0.0/10", "198.18.0.0/15"} {
		if netip.MustParsePrefix(block).Contains(ip) {
			return false
		}
	}
	return true
}

func providerClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			if err != nil {
				slog.Warn("操作失败", "module", "videogen", "operation", "providerClient", "error", err)
			}
			return nil, errResolveFailed
		}
		for _, ip := range ips {
			if !externalIP(ip) {
				return nil, errAddressBlocked
			}
		}
		var last error
		for _, ip := range ips {
			conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil {
				return conn, nil
			}
			last = err
		}
		return nil, last
	}
	return &http.Client{Timeout: 45 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func providerURL(base, endpoint string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		if err != nil {
			slog.Warn("操作失败", "module", "videogen", "operation", "providerURL", "error", err)
		}
		return "", errUpstreamURL
	}
	suffix, err := url.Parse(endpoint)
	if err != nil || suffix.IsAbs() || suffix.Host != "" || suffix.User != nil || suffix.Fragment != "" {
		if err != nil {
			slog.Warn("操作失败", "module", "videogen", "operation", "providerURL", "error", err)
		}
		return "", errUpstreamEndpoint
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/" + strings.TrimLeft(suffix.Path, "/")
	u.RawQuery = suffix.RawQuery
	return u.String(), nil
}

func providerJSON(ctx context.Context, client *http.Client, method, base, endpoint, apiKey string, payload any) ([]byte, int, error) {
	address, err := providerURL(base, endpoint)
	if err != nil {
		return nil, 0, err
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil || len(encoded) > 40<<20 {
			if err != nil {
				slog.WarnContext(ctx, "操作失败", "module", "videogen", "operation", "providerJSON", "error", err)
			}
			return nil, 0, errors.New("视频上游请求超过大小限制")
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, address, body)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "videogen", "operation", "providerJSON", "error", err)
		}
	}()
	content, err := io.ReadAll(io.LimitReader(response.Body, maxProviderResponse+1))
	if err != nil || len(content) > maxProviderResponse {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "videogen", "operation", "providerJSON", "error", err)
		}
		return nil, 0, errors.New("视频上游响应过大或读取失败")
	}
	return content, response.StatusCode, nil
}

var (
	errOutputURL        = diagnosticError{code: "video_output_url_invalid", message: "生成视频地址无效"}
	errOutputTooLarge   = diagnosticError{code: "video_output_too_large", message: "生成视频超出大小限制"}
	errOutputEmpty      = diagnosticError{code: "video_output_empty", message: "生成视频内容为空"}
	errOutputIncomplete = diagnosticError{code: "video_output_incomplete", message: "生成视频下载不完整"}
)

type mediaResponseError struct {
	diagnosticError
	status   int
	expected int64
}

func downloadClient(client *http.Client) *http.Client {
	copy := *client
	if copy.Timeout < outputDownloadTimeout {
		copy.Timeout = outputDownloadTimeout
	}
	return &copy
}

func providerMedia(ctx context.Context, client *http.Client, address string) (io.ReadCloser, int64, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		if err != nil {
			slog.WarnContext(ctx, "操作失败", "module", "videogen", "operation", "providerMedia", "error", err)
		}
		return nil, 0, errOutputURL
	}
	client = downloadClient(client)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	var invalid diagnosticError
	switch {
	case response.StatusCode != http.StatusOK:
		invalid = diagnosticError{code: "video_output_http_error", message: "生成视频响应状态异常"}
	case response.ContentLength > maxOutputBytes:
		invalid = errOutputTooLarge
	case response.ContentLength == 0:
		invalid = errOutputEmpty
	}
	if invalid.code != "" {
		if err := response.Body.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "videogen", "operation", "providerMedia", "error", err)
		}
		return nil, 0, &mediaResponseError{diagnosticError: invalid, status: response.StatusCode, expected: response.ContentLength}
	}
	return response.Body, response.ContentLength, nil
}

func providerTaskPath(id string) (string, error) {
	if id == "" || len(id) > 128 || strings.ContainsAny(id, "/?#\\") {
		return "", errors.New("供应商任务 ID 无效")
	}
	return url.PathEscape(id), nil
}

func durationMillis(seconds json.Number, maxSeconds int64) (int64, error) {
	value, ok := new(big.Rat).SetString(string(seconds))
	if !ok || value.Sign() <= 0 || value.Cmp(big.NewRat(maxSeconds, 1)) > 0 {
		return 0, errors.New("上游时长无效")
	}
	ms := new(big.Int).Mul(value.Num(), big.NewInt(1000))
	ms.Add(ms, new(big.Int).Div(value.Denom(), big.NewInt(2)))
	ms.Div(ms, value.Denom())
	if !ms.IsInt64() {
		return 0, errors.New("上游时长超出范围")
	}
	return ms.Int64(), nil
}
