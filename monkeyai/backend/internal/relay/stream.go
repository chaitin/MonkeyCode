package relay

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"time"

	"github.com/hashicorp/yamux"
)

type meteredConn struct {
	net.Conn
	metrics *relayMetrics
}

func (c *meteredConn) Close() error {
	// yamux.Close 是半关闭；先中断读写，确保代理两侧都能退出。
	if err := c.Conn.SetDeadline(time.Now()); err != nil {
		slog.Error("设置连接截止时间失败", "module", "relay", "operation", "Close", "error", err)
	}
	return c.Conn.Close()
}

type upgradeBody struct{ io.ReadWriteCloser }

func (b upgradeBody) Read(p []byte) (int, error) {
	n, err := b.ReadWriteCloser.Read(p)
	if err == io.EOF {
		// Upgrade 的任一方向结束都应关闭整个附着，避免等待 TCP 半关闭。
		err = net.ErrClosed
	}
	return n, err
}

func (c *meteredConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.metrics.received.Add(int64(n))
	return n, err
}
func (c *meteredConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.metrics.sent.Add(int64(n))
	return n, err
}

// OpenStream 不支持 context。并发 worker 有独立上限，且取消后回收迟到流。
func (s *Service) openStream(ctx context.Context, mux *yamux.Session, opens chan struct{}, a *access, permit *dataPermit) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case opens <- struct{}{}:
	default:
		return nil, errors.New("开流等待达到上限")
	}
	releaseOpen := func() {}
	if permit != nil {
		releaseOpen = permit.retain()
		if releaseOpen == nil {
			<-opens
			return nil, context.Canceled
		}
	}
	type result struct {
		conn net.Conn
		err  error
	}
	done := make(chan result)
	go func() {
		defer func() {
			<-opens
			releaseOpen()
		}()
		stream, err := mux.OpenStream()
		var conn net.Conn
		if err == nil {
			conn = &meteredConn{Conn: stream, metrics: &s.metrics}
			a.mu.Lock()
			if a.closed || ctx.Err() != nil {
				a.mu.Unlock()
				if err := conn.Close(); err != nil {
					slog.Error("关闭资源失败", "module", "relay", "operation", "openStream", "error", err)
				}
				return
			}
			a.stream = conn
			if err := conn.SetDeadline(minTime(a.expiresAt, a.verifiedAt.Add(180*time.Second))); err != nil {
				slog.Error("设置连接截止时间失败", "module", "relay", "operation", "openStream", "error", err)
			}
			a.mu.Unlock()
		}
		select {
		case done <- result{conn, err}:
		case <-ctx.Done():
			if conn != nil {
				if err := conn.Close(); err != nil {
					slog.Error("关闭资源失败", "module", "relay", "operation", "openStream", "error", err)
				}
			}
		}
	}()
	select {
	case out := <-done:
		return out.conn, out.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
