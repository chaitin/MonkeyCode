package request

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Client HTTP 客户端
type Client struct {
	scheme string
	host   string
	client *http.Client
	tr     *http.Transport
	debug  bool
	logger *slog.Logger
}

// SetLogger 设置日志
func (c *Client) SetLogger(logger *slog.Logger) { c.logger = logger }

// SetDebug 设置调试模式
func (c *Client) SetDebug(debug bool) { c.debug = debug }

// GetScheme 获取协议
func (c *Client) GetScheme() string { return c.scheme }

// GetHost 获取主机地址
func (c *Client) GetHost() string { return c.host }

// NewClient 创建 HTTP 客户端
func NewClient(scheme string, host string, timeout time.Duration, opts ...ReqOpt) *Client {
	req := &Client{
		scheme: scheme,
		host:   host,
		client: &http.Client{
			Timeout: timeout,
		},
		debug: false,
	}

	for _, opt := range opts {
		opt(req)
	}

	if req.tr != nil {
		req.client.Transport = req.tr
	}

	return req
}

func sendRequest[T any](c *Client, method, path string, opts ...Opt) (*T, error) {
	u := url.URL{
		Scheme: c.scheme,
		Host:   c.host,
		Path:   path,
	}
	ctx := &Ctx{}
	rid := uuid.NewString()

	for _, opt := range opts {
		opt(ctx)
	}

	if len(ctx.query) > 0 {
		values := u.Query()
		for k, v := range ctx.query {
			values.Add(k, v)
		}
		u.RawQuery = values.Encode()
	}

	if c.debug {
		log.Printf("[REQ:%s] url: %s", rid, u.String())
	}

	var body io.Reader
	if ctx.body != nil {
		bs, err := json.Marshal(ctx.body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewBuffer(bs)

		if c.debug {
			buf := &bytes.Buffer{}
			json.Indent(buf, bs, "", "  ")
			log.Printf("[REQ:%s] body: %s", rid, buf.String())
		}
	}

	reqCtx := ctx.ctx
	if reqCtx == nil {
		reqCtx = context.Background()
	}
	req, err := http.NewRequestWithContext(reqCtx, method, u.String(), body)
	if err != nil {
		return nil, err
	}
	for k, v := range ctx.header {
		req.Header.Add(k, v)
	}
	req.Header.Set("Content-Type", "application/json")

	if c.debug {
		log.Printf("[REQ:%s] headers: %+v", rid, req.Header)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if c.debug {
		log.Printf("[REQ:%s] status: %s\n", rid, resp.Status)
		log.Printf("[REQ:%s] resp header: %+v\n", rid, resp.Header)
		buf := &bytes.Buffer{}
		if err := json.Indent(buf, b, "", "  "); err != nil {
			log.Printf("[REQ:%s] resp: %s", rid, string(b))
		} else {
			log.Printf("[REQ:%s] resp: %s", rid, buf.String())
		}
	}

	if ctx.hook != nil {
		ctx.hook(resp.Header)
	}

	// Check HTTP status code
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}

	var rr T
	if err := json.Unmarshal(b, &rr); err != nil {
		return nil, fmt.Errorf("request err: %s body: %s", err.Error(), string(b))
	}
	return &rr, nil
}

// Get 发送 GET 请求
func Get[T any](c *Client, ctx context.Context, path string, opts ...Opt) (*T, error) {
	opts = append(opts, WithContext(ctx))
	return sendRequest[T](c, http.MethodGet, path, opts...)
}

// Post 发送 POST 请求
func Post[T any](c *Client, ctx context.Context, path string, body any, opts ...Opt) (*T, error) {
	opts = append(opts, WithBody(body), WithContext(ctx))
	return sendRequest[T](c, http.MethodPost, path, opts...)
}

// Put 发送 PUT 请求
func Put[T any](c *Client, ctx context.Context, path string, body any, opts ...Opt) (*T, error) {
	opts = append(opts, WithBody(body), WithContext(ctx))
	return sendRequest[T](c, http.MethodPut, path, opts...)
}

// Delete 发送 DELETE 请求
func Delete[T any](c *Client, ctx context.Context, path string, opts ...Opt) (*T, error) {
	opts = append(opts, WithContext(ctx))
	return sendRequest[T](c, http.MethodDelete, path, opts...)
}

// PostURL 向完整 URL 发送 POST 请求（无需 Client 实例）
func PostURL[T any](ctx context.Context, rawURL string, body any, opts ...Opt) (*T, error) {
	c := &Ctx{}
	for _, opt := range opts {
		opt(c)
	}

	var reader io.Reader
	if body != nil {
		bs, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewBuffer(bs)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range c.header {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}

	var rr T
	if err := json.Unmarshal(b, &rr); err != nil {
		return nil, fmt.Errorf("request err: %s body: %s", err.Error(), string(b))
	}
	return &rr, nil
}

// GetHeaderMap 解析 header 字符串为 map
// 格式: "Key1=Value1\nKey2=Value2"
func GetHeaderMap(header string) map[string]string {
	headerMap := make(map[string]string)
	for h := range strings.SplitSeq(header, "\n") {
		if key, value, ok := strings.Cut(h, "="); ok {
			headerMap[key] = value
		}
	}
	return headerMap
}
