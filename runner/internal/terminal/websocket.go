package terminal

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketHandler struct {
	manager *Manager
	logger  *slog.Logger
}

func NewWebSocketHandler(manager *Manager, logger *slog.Logger) *WebSocketHandler {
	return &WebSocketHandler{
		manager: manager,
		logger:  logger,
	}
}

func (h *WebSocketHandler) Upgrade(w http.ResponseWriter, r *http.Request) (*WebSocketConn, error) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}
	return &WebSocketConn{
		conn: conn,
	}, nil
}

type WebSocketConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *WebSocketConn) Read() ([]byte, error) {
	_, data, err := c.conn.ReadMessage()
	return data, err
}

func (c *WebSocketConn) Write(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (c *WebSocketConn) WriteText(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *WebSocketConn) Close() error {
	return c.conn.Close()
}

func (h *WebSocketHandler) HandleTerminal(ctx context.Context, wsConn *WebSocketConn, term *Terminal) {
	done := make(chan struct{})

	go func() {
		defer close(done)

		buf := make([]byte, 1024)
		for {
			select {
			case <-ctx.Done():
				return
			case <-term.Done():
				return
			default:
				n, err := term.Read(buf)
				if err != nil {
					h.logger.Debug("terminal read error", "error", err)
					return
				}
				if n > 0 {
					if err := wsConn.Write(buf[:n]); err != nil {
						h.logger.Debug("websocket write error", "error", err)
						return
					}
				}
			}
		}
	}()

	go func() {
		defer close(done)

		for {
			select {
			case <-ctx.Done():
				return
			case <-term.Done():
				return
			default:
				data, err := wsConn.Read()
				if err != nil {
					h.logger.Debug("websocket read error", "error", err)
					return
				}

				if len(data) > 0 {
					if data[0] == 1 && len(data) >= 5 {
						cols := uint16(data[1])<<8 | uint16(data[2])
						rows := uint16(data[3])<<8 | uint16(data[4])
						term.Resize(Resize{Cols: cols, Rows: rows})
					} else {
						if _, err := term.Write(data); err != nil {
							h.logger.Debug("terminal write error", "error", err)
							return
						}
					}
				}
			}
		}
	}()

	select {
	case <-ctx.Done():
	case <-done:
	case <-time.After(30 * time.Minute):
		h.logger.Info("terminal session timeout")
	}

	wsConn.Close()
	term.Close()
}
