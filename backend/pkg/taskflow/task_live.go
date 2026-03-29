package taskflow

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/coder/websocket"
)

// TaskLive 连接 taskflow 的 task-live WebSocket 并处理消息流
func (c *Client) TaskLive(ctx context.Context, taskID string, flush bool, fn func(*TaskChunk) error) error {
	wsScheme := "ws"
	if c.client.GetScheme() == "https" {
		wsScheme = "wss"
	}

	u := &url.URL{
		Scheme: wsScheme,
		Host:   c.client.GetHost(),
		Path:   "/internal/ws/task-live",
	}
	values := url.Values{}
	values.Add("id", taskID)
	values.Add("flush", fmt.Sprintf("%t", flush))
	u.RawQuery = values.Encode()

	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{})
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}

		var chunk TaskChunk
		if err := json.Unmarshal(data, &chunk); err != nil {
			return fmt.Errorf("unmarshal task chunk: %w", err)
		}

		if err := fn(&chunk); err != nil {
			return err
		}
	}
}
