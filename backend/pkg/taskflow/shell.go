package taskflow

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Shell WebSocket 终端 shell 实现，支持自动重连和 keepalive
type Shell struct {
	ctx        context.Context
	cancel     context.CancelCauseFunc
	conn       *websocket.Conn
	dial       func(context.Context) (*websocket.Conn, error)
	mu         sync.Mutex
	pingTicker *time.Ticker
}

var _ Sheller = &Shell{}

func (s *Shell) startPing() {
	s.mu.Lock()
	if s.pingTicker != nil {
		s.mu.Unlock()
		return
	}
	ticker := time.NewTicker(15 * time.Second)
	s.pingTicker = ticker
	s.mu.Unlock()

	go func(ticker *time.Ticker) {
		defer func() {
			ticker.Stop()
			s.mu.Lock()
			if s.pingTicker == ticker {
				s.pingTicker = nil
			}
			s.mu.Unlock()
		}()

		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.mu.Lock()
				conn := s.conn
				s.mu.Unlock()

				if conn == nil {
					_ = s.reconnect(s.ctx)
					continue
				}

				pctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
				if err := conn.Ping(pctx); err != nil {
					cancel()
					_ = s.reconnect(s.ctx)
					continue
				}
				cancel()
			}
		}
	}(ticker)
}

func (s *Shell) reconnect(ctx context.Context) error {
	backoff := 1 * time.Second
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		nc, err := s.dial(ctx)
		if err == nil {
			s.mu.Lock()
			old := s.conn
			s.conn = nc
			s.mu.Unlock()
			if old != nil {
				_ = old.Close(websocket.StatusNormalClosure, "reconnect")
			}
			return nil
		}

		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

// BlockRead 阻塞读取终端数据，支持自动重连
func (s *Shell) BlockRead(fn func(TerminalData)) error {
	for {
		select {
		case <-s.ctx.Done():
			return s.ctx.Err()
		default:
		}

		s.mu.Lock()
		conn := s.conn
		s.mu.Unlock()
		if conn == nil {
			if err := s.reconnect(s.ctx); err != nil {
				return err
			}
			continue
		}

		tp, data, err := conn.Read(s.ctx)
		if err != nil {
			if rerr := s.reconnect(s.ctx); rerr != nil {
				return rerr
			}
			continue
		}

		switch tp {
		case websocket.MessageBinary:
			fn(TerminalData{Data: data})
		case websocket.MessageText:
			var tdata TerminalData
			if err := json.Unmarshal(data, &tdata); err != nil {
				slog.With("error", err).ErrorContext(context.Background(), "failed to unmarshal terminal text message")
				continue
			}
			fn(tdata)
		}
	}
}

// Stop 停止终端连接
func (s *Shell) Stop() {
	s.mu.Lock()
	if s.pingTicker != nil {
		s.pingTicker.Stop()
		s.pingTicker = nil
	}
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()

	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "stop by user")
	}
	s.cancel(fmt.Errorf("stop by user"))
}

// Write 向终端写入数据，支持超时和自动重连
func (s *Shell) Write(data TerminalData) error {
	writeOnce := func(conn *websocket.Conn) error {
		wctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
		defer cancel()

		if len(data.Data) > 0 {
			if err := conn.Write(wctx, websocket.MessageBinary, data.Data); err != nil {
				return err
			}
		}
		if data.Resize != nil {
			b, err := json.Marshal(data.Resize)
			if err != nil {
				return err
			}
			if err := conn.Write(wctx, websocket.MessageText, b); err != nil {
				return err
			}
		}
		return nil
	}

	s.mu.Lock()
	conn := s.conn
	s.mu.Unlock()

	if conn == nil {
		if err := s.reconnect(s.ctx); err != nil {
			return err
		}
		s.mu.Lock()
		conn = s.conn
		s.mu.Unlock()
	}

	if err := writeOnce(conn); err != nil {
		if rerr := s.reconnect(s.ctx); rerr != nil {
			return rerr
		}
		s.mu.Lock()
		conn = s.conn
		s.mu.Unlock()
		return writeOnce(conn)
	}

	return nil
}
