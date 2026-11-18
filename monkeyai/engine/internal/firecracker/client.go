package firecracker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"time"
)

const maxResponse = 64 << 10

type Client struct {
	http      *http.Client
	transport *http.Transport
}

func NewClient(socket string) (*Client, error) {
	if !filepath.IsAbs(socket) || filepath.Clean(socket) != socket || len(socket) > 100 {
		return nil, errors.New("Firecracker socket 路径无效")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	}, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 2, ResponseHeaderTimeout: 5 * time.Second, MaxResponseHeaderBytes: 8192, DisableCompression: true}
	return &Client{http: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("拒绝 Firecracker API 重定向") }}, transport: transport}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://localhost"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return err
	}
	if len(raw) > maxResponse {
		return errors.New("Firecracker API 响应超过上限")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Firecracker API %s %s 返回状态码 %d", method, path, resp.StatusCode)
	}
	if out == nil {
		if len(bytes.TrimSpace(raw)) != 0 {
			return errors.New("Firecracker API 返回意外内容")
		}
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(out); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return errors.New("Firecracker API 响应包含多余内容")
	}
	return nil
}

type Info struct {
	ID      string `json:"id"`
	State   string `json:"state"`
	Version string `json:"vmm_version"`
	App     string `json:"app_name"`
}

func (c *Client) Info(ctx context.Context) (Info, error) {
	var info Info
	err := c.call(ctx, "GET", "/", nil, &info)
	if err == nil && info.State != "Not started" && info.State != "Running" && info.State != "Paused" {
		err = errors.New("Firecracker 返回未知运行状态")
	}
	return info, err
}
func (c *Client) Configure(ctx context.Context, config Config) error {
	if err := config.Validate(); err != nil {
		return err
	}
	info, err := c.Info(ctx)
	if err != nil {
		return err
	}
	if info.ID != config.ID || info.State != "Not started" {
		return errors.New("Firecracker 实例身份或初始化状态不符")
	}
	requests := []struct {
		path string
		data any
	}{
		{"/machine-config", config.Machine}, {"/boot-source", config.Boot},
		{"/drives/root", config.Disk},
		{"/vsock", config.Vsock},
	}
	if config.Network != nil {
		requests = append(requests, struct {
			path string
			data any
		}{"/network-interfaces/eth0", config.Network})
	}
	for _, r := range requests {
		if err := c.call(ctx, "PUT", r.path, r.data, nil); err != nil {
			return err
		}
	}
	return nil
}
func (c *Client) Start(ctx context.Context, id string) error {
	info, err := c.Info(ctx)
	if err != nil {
		return err
	}
	if info.ID != id || info.State != "Not started" {
		return errors.New("拒绝启动身份不符或已经运行的虚拟机")
	}
	return c.call(ctx, "PUT", "/actions", map[string]string{"action_type": "InstanceStart"}, nil)
}
func (c *Client) Pause(ctx context.Context, id string) error  { return c.state(ctx, id, "Paused") }
func (c *Client) Resume(ctx context.Context, id string) error { return c.state(ctx, id, "Resumed") }
func (c *Client) state(ctx context.Context, id, state string) error {
	info, err := c.Info(ctx)
	if err != nil {
		return err
	}
	if info.ID != id {
		return errors.New("虚拟机身份不匹配")
	}
	if state == "Paused" && info.State == "Paused" {
		return nil
	}
	if state == "Resumed" && info.State == "Running" {
		return nil
	}
	if info.State != "Running" && info.State != "Paused" {
		return errors.New("虚拟机尚未启动")
	}
	return c.call(ctx, "PATCH", "/vm", map[string]string{"state": state}, nil)
}
