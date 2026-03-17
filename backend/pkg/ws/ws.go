package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

// WebsocketManager 管理 coder/websocket 连接，提供并发安全的写入
type WebsocketManager struct {
	conn *websocket.Conn
	ip   string
	mu   sync.Mutex
}

// Accept 从 HTTP 请求升级到 WebSocket 连接
func Accept(w http.ResponseWriter, r *http.Request) (*WebsocketManager, error) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return nil, err
	}
	return &WebsocketManager{
		conn: conn,
		ip:   r.Header.Get("X-Real-IP"),
	}, nil
}

// WriteJSON 发送 JSON 消息
func (w *WebsocketManager) WriteJSON(v any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return w.conn.Write(context.Background(), websocket.MessageText, b)
}

// ReadMessage 读取消息，返回消息内容
func (w *WebsocketManager) ReadMessage() ([]byte, error) {
	_, data, err := w.conn.Read(context.Background())
	return data, err
}

// Close 关闭 WebSocket 连接
func (w *WebsocketManager) Close() error {
	return w.conn.Close(websocket.StatusNormalClosure, "close")
}

// Conn 返回底层连接
func (w *WebsocketManager) Conn() *websocket.Conn {
	return w.conn
}

// IP 返回客户端 IP
func (w *WebsocketManager) IP() string {
	return w.ip
}
