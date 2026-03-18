// Package loki 提供 Loki 日志查询客户端
package loki

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client Loki 客户端
type Client struct {
	baseURL    string
	httpClient *http.Client
	basicUser  string
	basicPass  string
	bearerToken string
	orgID      string
	headers    http.Header
	logger     *slog.Logger
}

// Option 配置选项
type Option func(*Client)

func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) { c.httpClient = hc }
}

func WithBasicAuth(user, pass string) Option {
	return func(c *Client) { c.basicUser = user; c.basicPass = pass }
}

func WithBearerToken(token string) Option {
	return func(c *Client) { c.bearerToken = token }
}

func WithOrgID(orgID string) Option {
	return func(c *Client) { c.orgID = orgID }
}

func WithLogger(logger *slog.Logger) Option {
	return func(c *Client) { c.logger = logger }
}

// NewClient 创建 Loki 客户端
func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		headers: make(http.Header),
		logger:  slog.Default(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// LogEntry 日志条目
type LogEntry struct {
	Timestamp time.Time
	Line      string
	Labels    map[string]string
}

// QueryByTaskID 根据 task_id 查询区间日志
func (c *Client) QueryByTaskID(ctx context.Context, taskID string, start, end time.Time, limit int, direction string) ([]LogEntry, error) {
	if direction == "" {
		direction = "backward"
	}
	if direction != "forward" && direction != "backward" {
		direction = "backward"
	}
	if limit <= 0 {
		limit = 200
	}
	q := fmt.Sprintf(`{task_id="%s"}`, escapeLabelValue(taskID))

	v := url.Values{}
	v.Set("query", q)
	v.Set("limit", strconv.Itoa(limit))

	if end.IsZero() {
		end = time.Now()
	}
	if start.IsZero() {
		start = time.Unix(0, 0)
	}
	if !start.Before(end) {
		end = start.Add(time.Nanosecond)
	}

	v.Set("start", strconv.FormatInt(start.UnixNano(), 10))
	v.Set("end", strconv.FormatInt(end.UnixNano(), 10))
	v.Set("direction", direction)

	u := c.baseURL + "/loki/api/v1/query_range?" + v.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	c.decorateReq(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024))
		return nil, fmt.Errorf("loki query_range failed: status=%d body=%s", resp.StatusCode, string(body))
	}

	var qr lokiQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&qr); err != nil {
		return nil, err
	}
	if qr.Data.ResultType != "" && qr.Data.ResultType != "streams" {
		return nil, fmt.Errorf("unexpected loki resultType: %s", qr.Data.ResultType)
	}

	out := make([]LogEntry, 0, 128)
	for _, r := range qr.Data.Result {
		lbls := r.Stream
		for _, val := range r.Values {
			if len(val) != 2 {
				continue
			}
			ns, err := strconv.ParseInt(val[0], 10, 64)
			if err != nil {
				continue
			}
			out = append(out, LogEntry{
				Timestamp: time.Unix(0, ns).UTC(),
				Line:      val[1],
				Labels:    lbls,
			})
		}
	}
	return out, nil
}

// History 分页获取历史日志
func (c *Client) History(ctx context.Context, taskID string, start time.Time, fn func([]LogEntry)) error {
	if start.IsZero() {
		start = time.Now().Add(-24 * time.Hour)
	}
	end := time.Now()
	limit := 200
	for {
		logs, err := c.QueryByTaskID(ctx, taskID, start, end, limit, "forward")
		if err != nil {
			return err
		}

		fn(logs)
		if len(logs) < limit {
			break
		}
		start = logs[len(logs)-1].Timestamp.Add(time.Nanosecond)
	}
	return nil
}

// Tail 实时追踪任务日志，先拉取历史再通过轮询追踪新日志
// start: 查询起始时间
// limit: 单次查询最大条数
// fn: 回调函数，收到日志后调用
func (c *Client) Tail(ctx context.Context, taskID string, start time.Time, limit int, fn func([]LogEntry) error) error {
	if limit <= 0 {
		limit = 200
	}

	// 阶段 1: 拉取历史日志
	histEnd := time.Now()
	histStart := start

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		entries, err := c.QueryByTaskID(ctx, taskID, histStart, histEnd, limit, "forward")
		if err != nil {
			return fmt.Errorf("historical query failed: %w", err)
		}
		if len(entries) > 0 {
			if err := fn(entries); err != nil {
				return err
			}
			histStart = entries[len(entries)-1].Timestamp.Add(time.Nanosecond)
		}
		if len(entries) < limit {
			break
		}
	}

	// 阶段 2: 轮询新日志
	pollStart := histStart
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			entries, err := c.QueryByTaskID(ctx, taskID, pollStart, time.Now(), limit, "forward")
			if err != nil {
				c.logger.Warn("tail poll failed", "error", err, "task_id", taskID)
				continue
			}
			if len(entries) > 0 {
				if err := fn(entries); err != nil {
					return err
				}
				pollStart = entries[len(entries)-1].Timestamp.Add(time.Nanosecond)
			}
		}
	}
}

func (c *Client) decorateReq(req *http.Request) {
	for k, vals := range c.headers {
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}
	if c.orgID != "" {
		req.Header.Set("X-Scope-OrgID", c.orgID)
	}
	if c.bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearerToken)
	} else if c.basicUser != "" || c.basicPass != "" {
		req.SetBasicAuth(c.basicUser, c.basicPass)
	}
}

func escapeLabelValue(v string) string {
	return strings.ReplaceAll(v, `"`, `\"`)
}

func basicAuth(user, pass string) string {
	return base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
}

type lokiQueryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string           `json:"resultType"`
		Result     []lokiQueryFrame `json:"result"`
	} `json:"data"`
}

type lokiQueryFrame struct {
	Stream map[string]string `json:"stream"`
	Values [][]string        `json:"values"`
}
