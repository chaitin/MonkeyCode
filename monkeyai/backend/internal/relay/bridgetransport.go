// [INPUT]: HTTP 升级连接、coder/websocket 的消息读取与 relay 的确认解码。
// [OUTPUT]: 接管设备连接，读取 ready_ack 时保留传输 EOF 与消息结束的区别。
// [POS]: bridge 的传输适配层。WebSocket 库负责分帧，bridge 负责确认内容和回包。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"

	"github.com/coder/websocket"
)

type bridgeTransport struct {
	net.Conn
	readingAck bool
}

func (c *bridgeTransport) accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	// 与 websocket.Accept 一样，沿中间件寻找 Hijacker，保留原响应写入器。
	for inner := w; ; {
		if h, ok := inner.(http.Hijacker); ok {
			w = bridgeUpgrade{w, h, c}
			break
		}
		wrapper, ok := inner.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			break
		}
		inner = wrapper.Unwrap()
	}
	return websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
}

type bridgeUpgrade struct {
	http.ResponseWriter
	hijacker  http.Hijacker
	transport *bridgeTransport
}

func (w bridgeUpgrade) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, buffers, err := w.hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}
	w.transport.Conn = conn
	return w.transport, buffers, nil
}

func (c *bridgeTransport) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	// coder/websocket 会把底层 EOF 当成消息结束。确认必须读到最终分片。
	if err != nil && c.readingAck && errors.Is(err, io.EOF) {
		return n, io.ErrUnexpectedEOF
	}
	return n, err
}

func (c *bridgeTransport) readAck(ctx context.Context, ws *websocket.Conn, ack *ReadyAck) error {
	// 握手是唯一的读取方，返回后 bridge 才把读取权交给 yamux。
	c.readingAck = true
	defer func() { c.readingAck = false }()
	return readWS(ctx, ws, ack)
}
