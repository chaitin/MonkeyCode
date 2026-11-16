package guest

import (
	"bufio"
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDialHandshake(t *testing.T) {
	for _, reply := range []string{"OK 10789\n", "BAD\n", "OK nope\n"} {
		t.Run(reply, func(t *testing.T) {
			dir, err := os.MkdirTemp("/tmp", "fc-vsock-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			socket := filepath.Join(dir, "vsock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan error, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					done <- err
					return
				}
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(3 * time.Second))
				line, err := bufio.NewReader(conn).ReadString('\n')
				if err == nil && line != "CONNECT 10789\n" {
					t.Error(line)
				}
				if err == nil {
					_, err = conn.Write([]byte(reply))
				}
				done <- err
			}()
			conn, err := Dial(socket, Port)(context.Background())
			if reply == "OK 10789\n" {
				if err != nil {
					t.Fatal(err)
				}
				conn.Close()
			} else if err == nil {
				conn.Close()
				t.Fatal("接受无效握手")
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}
