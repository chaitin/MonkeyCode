package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if os.Getpid() != 1 {
		return errors.New("最小虚拟机自检程序仅允许作为测试虚拟机PID1运行")
	}
	if err := mountFilesystems(); err != nil {
		return err
	}
	raw, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return err
	}
	b, err := guest.ParseBinding(string(raw))
	if err != nil {
		return err
	}
	enabled := false
	for _, field := range strings.Fields(string(raw)) {
		if field == "monkeyai.selftest=1" {
			enabled = true
		}
	}
	if !enabled {
		return errors.New("缺少虚拟机自检标识")
	}
	listener, err := guest.Listen()
	if err != nil {
		return err
	}
	defer listener.Close()
	handler, err := guest.NewService(b, selftestBackend{})
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	return server.Serve(listener)
}

// 自检不登录设备、不运行用户runtime，公开状态请求只用于验证双向管理通道。
type selftestBackend struct{}

func (selftestBackend) Status(context.Context) (standalone.Status, error) {
	return standalone.Status{}, nil
}
func (selftestBackend) Login(context.Context, lifecycle.Runtime, func(string) error) error {
	return errors.New("自检不提供设备登录")
}
func (selftestBackend) Serve(context.Context, bool) error {
	return errors.New("自检不提供runtime")
}
func (selftestBackend) Shutdown(context.Context) error { return errors.New("自检由宿主终止") }
