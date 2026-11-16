package guest

import (
	"context"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mdlayher/vsock"
)

// Dial 采用 Firecracker 的 CONNECT 协议；不能直接把 Unix socket 当成 HTTP。
func Dial(socket string, port uint32) func(context.Context) (net.Conn, error) {
	return func(ctx context.Context) (net.Conn, error) {
		if !filepath.IsAbs(socket) || filepath.Clean(socket) != socket || port == 0 {
			return nil, errors.New("vsock地址无效")
		}
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
		if err != nil {
			return nil, err
		}
		success := false
		defer func() {
			if !success {
				conn.Close()
			}
		}()
		stop := context.AfterFunc(ctx, func() { conn.Close() })
		defer stop()
		deadline := time.Now().Add(5 * time.Second)
		if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
			deadline = d
		}
		if err := conn.SetDeadline(deadline); err != nil {
			return nil, err
		}
		if _, err := fmt.Fprintf(conn, "CONNECT %d\n", port); err != nil {
			return nil, err
		}
		// 逐字节读取握手，避免预读后丢弃已经到达的管理协议数据。
		var line []byte
		var b [1]byte
		for len(line) < 64 {
			if _, err := conn.Read(b[:]); err != nil {
				return nil, err
			}
			if b[0] == '\n' {
				break
			}
			line = append(line, b[0])
		}
		fields := strings.Fields(string(line))
		if len(line) >= 64 || len(fields) != 2 || fields[0] != "OK" {
			return nil, errors.New("Firecracker vsock握手失败")
		}
		number, err := strconv.ParseUint(fields[1], 10, 32)
		if err != nil || number == 0 {
			return nil, errors.New("Firecracker vsock返回无效端口")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !stop() {
			return nil, errors.New("vsock连接已取消")
		}
		if err := conn.SetDeadline(time.Time{}); err != nil {
			return nil, err
		}
		success = true
		return conn, nil
	}
}

type HostListener struct{ net.Listener }

func (l HostListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		address, ok := conn.RemoteAddr().(*vsock.Addr)
		if ok && address.ContextID == vsock.Host {
			return conn, nil
		}
		_ = conn.Close()
	}
}
func Listen() (net.Listener, error) {
	listener, err := vsock.Listen(Port, nil)
	if err != nil {
		return nil, err
	}
	return HostListener{listener}, nil
}
