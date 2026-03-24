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

	"github.com/coder/websocket"
)

// Client Loki 客户端
type Client struct {
	baseURL     string
	httpClient  *http.Client
	basicUser   string
	basicPass   string
	bearerToken string
	orgID       string
	headers     http.Header
	logger      *slog.Logger
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

// Tail 使用 WebSocket 替代 HTTP 轮询，提供完整的实时日志流
// 策略：
//  1. 历史阶段：通过 HTTP 查询从 start 到 now-2s 的所有历史日志
//  2. 实时阶段：建立 WebSocket 连接，从 lastTS-2s 开始接收实时日志
//  3. 去重机制：基于"时间戳+日志内容"的复合键去重，处理同一纳秒的多条日志
//  4. 每收到一条日志立即调用回调函数（无批处理）
//
// start: 日志查询起始时间
// limit: 单次查询/接收的最大日志条数
// fn: 日志回调函数，接收单条日志的切片，返回 error 可中断处理
func (c *Client) Tail(ctx context.Context, taskID string, start time.Time, limit int, fn func([]LogEntry) error) error {
	// 参数校验与初始化
	if limit <= 0 {
		limit = 200
	}

	const skew = 2 * time.Second // Loki 聚合延迟安全窗口

	query := fmt.Sprintf(`{task_id="%s"}`, escapeLabelValue(taskID))

	// 去重状态：仅跟踪最新时间戳的日志
	var lastTS time.Time
	seenAtLastTS := make(map[string]struct{})

	// === 阶段 1: 历史数据查询 ===
	c.logger.With("task_id", taskID, "start", start).DebugContext(ctx, "Tail: starting historical phase")

	histEnd := time.Now().Add(-skew)
	histStart := start
	historicalFailed := false

	for {
		// 查询历史日志
		entries, err := c.QueryByTaskID(ctx, taskID, histStart, histEnd, limit, "forward")
		if err != nil {
			// 历史查询失败时，记录警告日志并继续进入 WebSocket 实时阶段
			c.logger.With("task_id", taskID, "error", err).WarnContext(ctx, "Tail: historical query failed, continuing to WebSocket phase")
			historicalFailed = true
			break
		}

		// 处理历史日志，应用去重逻辑并立即回调
		for _, e := range entries {
			key := e.Line // 使用日志内容作为去重键

			switch {
			case lastTS.IsZero():
				// 第一条日志
				lastTS = e.Timestamp
				seenAtLastTS = make(map[string]struct{})
				seenAtLastTS[key] = struct{}{}
				if err := fn([]LogEntry{e}); err != nil {
					return fmt.Errorf("callback error: %w", err)
				}

			case e.Timestamp.Before(lastTS):
				// 乱序日志（时间戳小于当前最大值），丢弃
				continue

			case e.Timestamp.Equal(lastTS):
				// 相同时间戳，按键去重
				if _, exists := seenAtLastTS[key]; exists {
					continue
				}
				seenAtLastTS[key] = struct{}{}
				if err := fn([]LogEntry{e}); err != nil {
					return fmt.Errorf("callback error: %w", err)
				}

			default: // e.Timestamp.After(lastTS)
				// 时间戳前进，更新去重状态
				lastTS = e.Timestamp
				seenAtLastTS = make(map[string]struct{})
				seenAtLastTS[key] = struct{}{}
				if err := fn([]LogEntry{e}); err != nil {
					return fmt.Errorf("callback error: %w", err)
				}
			}
		}

		// 检查是否完成历史查询
		if len(entries) < limit {
			// 历史数据已全部获取
			break
		}

		// 继续分页：从最后一条日志的时间戳 + 1ns 开始
		histStart = lastTS.Add(time.Nanosecond)
	}

	if historicalFailed {
		c.logger.With("task_id", taskID, "last_ts", lastTS).DebugContext(ctx, "Tail: historical phase ended early due to error")
	} else {
		c.logger.With("task_id", taskID, "last_ts", lastTS).DebugContext(ctx, "Tail: historical phase complete")
	}

	// === 阶段 2: WebSocket 实时流（带重连和心跳） ===
	c.logger.With("task_id", taskID).DebugContext(ctx, "Tail: starting WebSocket phase")

	// 构造 WebSocket 认证头（复用于每次连接）
	header := http.Header{}
	for k, vals := range c.headers {
		for _, v := range vals {
			header.Add(k, v)
		}
	}
	if c.orgID != "" {
		header.Set("X-Scope-OrgID", c.orgID)
	}
	if c.bearerToken != "" {
		header.Set("Authorization", "Bearer "+c.bearerToken)
	} else if c.basicUser != "" || c.basicPass != "" {
		header.Set("Authorization", "Basic "+basicAuth(c.basicUser, c.basicPass))
	}

	const (
		maxReconnectAttempts = 10
		initialBackoff       = 500 * time.Millisecond
		maxBackoff           = 10 * time.Second
		pingInterval         = 30 * time.Second
	)

	reconnectAttempts := 0

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// 构造 WebSocket URL，每次重连从 lastTS-skew 开始以利用去重
		q := url.Values{}
		q.Set("query", query)
		q.Set("limit", strconv.Itoa(limit))
		wsStart := lastTS
		if wsStart.IsZero() {
			wsStart = histEnd
		}
		wsStart = wsStart.Add(-skew)
		q.Set("start", strconv.FormatInt(wsStart.UnixNano(), 10))

		wsURL, err := c.toWebSocketURL("/loki/api/v1/tail", q)
		if err != nil {
			return fmt.Errorf("failed to build WebSocket URL: %w", err)
		}

		c.logger.With("task_id", taskID, "url", wsURL, "reconnect_attempts", reconnectAttempts).
			DebugContext(ctx, "Tail: connecting to WebSocket")

		conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
			HTTPHeader: header,
		})
		if err != nil {
			reconnectAttempts++
			if reconnectAttempts > maxReconnectAttempts {
				return fmt.Errorf("WebSocket dial failed after %d attempts: %w", maxReconnectAttempts, err)
			}
			backoff := min(initialBackoff*time.Duration(1<<(reconnectAttempts-1)), maxBackoff)
			c.logger.With("error", err, "task_id", taskID, "attempt", reconnectAttempts, "backoff", backoff).
				WarnContext(ctx, "Tail: WebSocket dial failed, retrying")
			select {
			case <-time.After(backoff):
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		conn.SetReadLimit(-1)

		// 连接成功，重置重连计数
		reconnectAttempts = 0
		c.logger.With("task_id", taskID).DebugContext(ctx, "Tail: WebSocket connected")

		// 运行单次 WebSocket 会话（含心跳）
		sessionErr := c.tailWebSocketSession(ctx, conn, pingInterval, &lastTS, seenAtLastTS, fn)
		conn.Close(websocket.StatusNormalClosure, "session ended")

		if sessionErr == nil {
			// 正常关闭（服务端主动断开），不重连
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// WebSocket 异常断开，尝试重连
		reconnectAttempts++
		if reconnectAttempts > maxReconnectAttempts {
			return fmt.Errorf("WebSocket failed after %d reconnect attempts: %w", maxReconnectAttempts, sessionErr)
		}
		backoff := min(initialBackoff*time.Duration(1<<(reconnectAttempts-1)), maxBackoff)
		c.logger.With("error", sessionErr, "task_id", taskID, "attempt", reconnectAttempts, "backoff", backoff).
			WarnContext(ctx, "Tail: WebSocket disconnected, reconnecting")
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// tailWebSocketSession 运行单次 Loki tail WebSocket 会话，包含心跳 ping 和消息处理。
// 返回 nil 表示连接正常关闭（不需要重连），返回 error 表示异常断开（需要重连）。
func (c *Client) tailWebSocketSession(
	ctx context.Context,
	conn *websocket.Conn,
	pingInterval time.Duration,
	lastTS *time.Time,
	seenAtLastTS map[string]struct{},
	fn func([]LogEntry) error,
) error {
	// 心跳 goroutine：定期发送 ping 防止空闲超时
	pingCtx, pingCancel := context.WithCancel(ctx)
	defer pingCancel()
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-pingCtx.Done():
				return
			case <-ticker.C:
				if err := conn.Ping(pingCtx); err != nil {
					c.logger.With("error", err).DebugContext(pingCtx, "Tail: ping failed")
					return
				}
			}
		}
	}()

	// 读取 goroutine
	msgCh := make(chan []byte, 32)
	errCh := make(chan error, 1)
	go func() {
		defer close(msgCh)
		defer close(errCh)
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				errCh <- err
				return
			}
			select {
			case msgCh <- data:
			case <-ctx.Done():
				return
			}
		}
	}()

	// 主事件循环
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case data, ok := <-msgCh:
			if !ok {
				// 读取 goroutine 退出且 channel 已空，检查是否有 error
				select {
				case err := <-errCh:
					return err
				default:
					return nil
				}
			}

			var msg lokiTailMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}

			for _, s := range msg.Streams {
				lbls := s.Stream
				for _, v := range s.Values {
					if len(v) != 2 {
						continue
					}

					ns, err := strconv.ParseInt(v[0], 10, 64)
					if err != nil {
						continue
					}
					ts := time.Unix(0, ns).UTC()
					key := v[1]

					entry := LogEntry{
						Timestamp: ts,
						Line:      v[1],
						Labels:    lbls,
					}

					switch {
					case lastTS.IsZero():
						*lastTS = ts
						// 清空并重用 seenAtLastTS
						for k := range seenAtLastTS {
							delete(seenAtLastTS, k)
						}
						seenAtLastTS[key] = struct{}{}
						if err := fn([]LogEntry{entry}); err != nil {
							return fmt.Errorf("callback error: %w", err)
						}

					case ts.Before(*lastTS):
						continue

					case ts.Equal(*lastTS):
						if _, exists := seenAtLastTS[key]; exists {
							continue
						}
						seenAtLastTS[key] = struct{}{}
						if err := fn([]LogEntry{entry}); err != nil {
							return fmt.Errorf("callback error: %w", err)
						}

					default: // ts.After(*lastTS)
						*lastTS = ts
						for k := range seenAtLastTS {
							delete(seenAtLastTS, k)
						}
						seenAtLastTS[key] = struct{}{}
						if err := fn([]LogEntry{entry}); err != nil {
							return fmt.Errorf("callback error: %w", err)
						}
					}
				}
			}

		case err := <-errCh:
			return err
		}
	}
}

func (c *Client) toWebSocketURL(path string, q url.Values) (string, error) {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	default:
		// 未指定 scheme 时默认按 ws 处理
		if u.Scheme == "" {
			u.Scheme = "ws"
		}
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = q.Encode()
	return u.String(), nil
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

type lokiTailMessage struct {
	Streams []lokiQueryFrame `json:"streams"`
	// dropped_entries 字段可能存在于某些版本，这里不强依赖
}
