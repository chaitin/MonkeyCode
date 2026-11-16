package guest

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

const Port uint32 = 10789

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)

type Binding struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	BootID        string `json:"boot_id"`
}

func (b Binding) Validate() error {
	if !idPattern.MatchString(b.EnvironmentID) || !idPattern.MatchString(b.InstanceID) || !idPattern.MatchString(b.BootID) {
		return errors.New("虚拟机管理身份无效")
	}
	return nil
}

type Request struct {
	Version int                `json:"version"`
	Binding Binding            `json:"binding"`
	Runtime *lifecycle.Runtime `json:"runtime,omitempty"`
	Observe bool               `json:"observe,omitempty"`
}
type Event struct {
	RuntimeVersion string             `json:"runtime_version,omitempty"`
	Event          string             `json:"event"`
	Code           string             `json:"user_code,omitempty"`
	Status         *standalone.Status `json:"status,omitempty"`
	Error          string             `json:"error,omitempty"`
}
type Backend interface {
	Status(context.Context) (standalone.Status, error)
	Login(context.Context, lifecycle.Runtime, func(string) error) error
	Serve(context.Context, bool) error
	Shutdown(context.Context) error
}
type Service struct {
	binding Binding
	backend Backend
}

func NewService(binding Binding, backend Backend) (*Service, error) {
	if err := binding.Validate(); err != nil {
		return nil, err
	}
	if backend == nil {
		return nil, errors.New("缺少虚拟机管理后端")
	}
	return &Service{binding, backend}, nil
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if r.URL.Path == "/v1/runtime" {
		s.installRuntime(w, r)
		return
	}
	switch r.URL.Path {
	case "/v1/version", "/v1/status", "/v1/login", "/v1/serve", "/v1/shutdown":
	default:
		w.WriteHeader(404)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8193))
	if err != nil || len(raw) > 8192 {
		w.WriteHeader(400)
		return
	}
	var in Request
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(new(any)) != io.EOF || in.Version != 1 || in.Binding != s.binding {
		w.WriteHeader(403)
		return
	}
	if r.URL.Path != "/v1/login" && in.Runtime != nil {
		w.WriteHeader(400)
		return
	}
	write := func(event Event) error {
		if err := json.NewEncoder(w).Encode(event); err != nil {
			return err
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return nil
	}
	var operationErr error
	switch r.URL.Path {
	case "/v1/version":
		backend, ok := s.backend.(interface {
			Version(context.Context) (string, error)
		})
		if !ok {
			operationErr = errors.New("不支持版本查询")
			break
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		value, err := backend.Version(ctx)
		if err != nil || !lifecycle.ValidRuntimeVersion(value) {
			operationErr = errors.New("版本查询失败")
			break
		}
		operationErr = write(Event{Event: "version", RuntimeVersion: value})
	case "/v1/status":
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		status, err := s.backend.Status(ctx)
		operationErr = err
		if err == nil {
			operationErr = write(Event{Event: "status", Status: &status})
		}
	case "/v1/login":
		if in.Runtime == nil || !validRuntime(*in.Runtime) {
			w.WriteHeader(400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 11*time.Minute)
		defer cancel()
		operationErr = s.backend.Login(ctx, *in.Runtime, func(code string) error {
			if len(code) == 0 || len(code) > 16 {
				return errors.New("设备码无效")
			}
			return write(Event{Event: "authorize", Code: code})
		})
	case "/v1/serve":
		operationErr = s.backend.Serve(r.Context(), in.Observe)
	case "/v1/shutdown":
		operationErr = s.backend.Shutdown(r.Context())
	}
	if operationErr != nil {
		_ = write(Event{Event: "error", Error: "operation_failed"})
		return
	}
	_ = write(Event{Event: "done"})
}
func validServer(server string) bool {
	u, err := url.Parse(server)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && !u.ForceQuery && !strings.ContainsAny(server, "\x00\r\n")
}

func validRuntime(r lifecycle.Runtime) bool {
	// 复用现有规范化URL和身份检查，不在管理协议引入任意命令参数。
	spec := lifecycle.Spec{Runtime: &r, NetworkPolicy: "public-only"}
	return idPattern.MatchString(spec.Runtime.ServerID) && idPattern.MatchString(spec.Runtime.UserID) && validServer(r.Server)
}

type Client struct {
	binding   Binding
	http      *http.Client
	transport *http.Transport
}

func NewClient(binding Binding, dial func(context.Context) (net.Conn, error)) (*Client, error) {
	if err := binding.Validate(); err != nil {
		return nil, err
	}
	if dial == nil {
		return nil, errors.New("缺少vsock连接器")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return dial(ctx) }, MaxConnsPerHost: 4, DisableCompression: true, ResponseHeaderTimeout: 20 * time.Second, MaxResponseHeaderBytes: 8192}
	return &Client{binding: binding, http: &http.Client{Transport: transport, Timeout: 12 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("拒绝管理服务重定向") }}, transport: transport}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) call(ctx context.Context, action string, in Request, handle func(Event) error) error {
	in.Binding = c.binding
	in.Version = 1
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, "POST", "http://guest/v1/"+action, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("虚拟机管理请求失败，状态码%d", resp.StatusCode)
	}
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, (64<<10)+1))
	scanner.Buffer(make([]byte, 4096), 16<<10)
	done := false
	total := 0
	for scanner.Scan() {
		total += len(scanner.Bytes()) + 1
		if total > 64<<10 || done {
			return errors.New("管理响应超过上限或包含尾随事件")
		}
		var event Event
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return errors.New("管理响应协议无效")
		}
		switch event.Event {
		case "done":
			done = true
		case "error":
			return errors.New("虚拟机管理操作失败")
		case "status", "authorize", "version":
			if handle == nil {
				return errors.New("意外管理事件")
			}
			if err := handle(event); err != nil {
				return err
			}
		default:
			return errors.New("未知管理事件")
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if !done {
		return errors.New("管理请求未确认完成")
	}
	return nil
}
func (c *Client) Status(ctx context.Context, _ lifecycle.Spec) (standalone.Status, error) {
	var status standalone.Status
	found := false
	err := c.call(ctx, "status", Request{}, func(event Event) error {
		if event.Event != "status" || found || event.Status == nil {
			return errors.New("运行时状态响应无效")
		}
		found = true
		status = *event.Status
		return nil
	})
	if err == nil && !found {
		err = errors.New("运行时未返回状态")
	}
	return status, err
}
func (c *Client) Login(ctx context.Context, s lifecycle.Spec, authorize func(string) error) error {
	if s.Runtime == nil || authorize == nil {
		return errors.New("缺少运行时身份或授权入口")
	}
	authorized := false
	err := c.call(ctx, "login", Request{Runtime: s.Runtime}, func(event Event) error {
		if event.Event != "authorize" || authorized || len(event.Code) == 0 || len(event.Code) > 16 {
			return errors.New("设备申请无效")
		}
		authorized = true
		return authorize(event.Code)
	})
	if err == nil && !authorized {
		return errors.New("未确认设备申请")
	}
	return err
}
func (c *Client) Serve(ctx context.Context, _ lifecycle.Spec, observe bool) error {
	return c.call(ctx, "serve", Request{Observe: observe}, nil)
}
func (c *Client) Shutdown(ctx context.Context) error { return c.call(ctx, "shutdown", Request{}, nil) }
