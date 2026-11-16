package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
)

func binding(raw string) (guest.Binding, error) {
	return guest.ParseBinding(raw)
}
func run(ctx context.Context) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return errors.New("管理服务仅允许在Linux虚拟机内以root运行")
	}
	raw, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return err
	}
	b, err := binding(string(raw))
	if err != nil {
		return err
	}
	handler, err := guest.NewService(b, guest.NewProcess())
	if err != nil {
		return err
	}
	listener, err := guest.Listen()
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 12 * time.Minute, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
