package dockerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"time"
)

const Socket = "/var/run/docker.sock"
const Runtime = "monkeyai-runsc"
const Owner = "io.monkeyai.owner"

type Client struct{ http *http.Client }
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("Docker API (%d): %s", e.Status, e.Message) }
func NotFound(err error) bool  { var e *Error; return errors.As(err, &e) && e.Status == 404 }
func New(socket string) *Client {
	return &Client{http: &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	}, ResponseHeaderTimeout: 30 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Docker API 拒绝重定向") }}}
}
func (c *Client) Close()     { c.http.CloseIdleConnections() }
func Escape(s string) string { return url.PathEscape(s) }
func (c *Client) Stream(ctx context.Context, method, path string, in any) (io.ReadCloser, error) {
	var r io.Reader
	if in != nil {
		b, e := json.Marshal(in)
		if e != nil {
			return nil, e
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker/v1.47"+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		var data struct{ Message string }
		_ = json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&data)
		return nil, &Error{resp.StatusCode, data.Message}
	}
	return resp.Body, nil
}
func (c *Client) Do(ctx context.Context, method, path string, in, out any) error {
	r, err := c.Stream(ctx, method, path, in)
	if err != nil {
		return err
	}
	defer r.Close()
	if out == nil {
		_, err = io.Copy(io.Discard, io.LimitReader(r, 1<<20))
		return err
	}
	return json.NewDecoder(io.LimitReader(r, 4<<20)).Decode(out)
}

type Info struct {
	OSType, Architecture, CgroupVersion, DockerRootDir             string
	MemoryLimit, SwapLimit, CPUCfsQuota, PidsLimit, IPv4Forwarding bool
	Runtimes                                                       map[string]struct {
		Path string
		Args []string `json:"runtimeArgs"`
	}
	SecurityOptions []string
}

func (c *Client) Info(ctx context.Context) (Info, error) {
	var i Info
	err := c.Do(ctx, "GET", "/info", nil, &i)
	return i, err
}
func (i Info) Validate() error {
	if i.OSType != "linux" || i.CgroupVersion != "2" || !i.MemoryLimit || !i.SwapLimit || !i.CPUCfsQuota || !i.PidsLimit {
		return errors.New("Docker 需要 Linux、cgroup v2 和 CPU/内存/swap/pids 限额支持")
	}
	r, ok := i.Runtimes[Runtime]
	if !ok || r.Path != "/opt/monkeyai-engine/current/bin/runsc" || !slices.Equal(r.Args, []string{"--platform=systrap", "--network=sandbox"}) {
		return errors.New("Docker 未配置专用 monkeyai-runsc runtime")
	}
	for _, v := range i.SecurityOptions {
		if v == "name=rootless" || v == "name=userns" {
			return errors.New("暂不支持 rootless 或 userns-remap Docker")
		}
	}
	return nil
}
