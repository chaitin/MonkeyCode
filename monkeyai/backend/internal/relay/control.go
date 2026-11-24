package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type Control struct{ client *http.Client }

type controlRequest struct {
	Action  string
	User    string
	Machine string
	Grant   string
	Version int64
}

type controlState struct {
	Ready  bool
	Status string
	Boot   string
	Epoch  int64
}

func controlPath(dir string) string {
	return filepath.Join(stateDir(dir), "relay-ipc", "control.sock")
}

func NewControl(dir string) *Control {
	return &Control{client: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", controlPath(dir))
		},
	}}}
}

func (c *Control) Close() { c.client.CloseIdleConnections() }

func (c *Control) call(ctx context.Context, in controlRequest) (out controlState, err error) {
	data, err := json.Marshal(in)
	if err != nil {
		return out, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://relay/control", bytes.NewReader(data))
	if err != nil {
		return out, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("Relay 内部请求失败：HTTP %d", resp.StatusCode)
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&out)
	return out, err
}

func (c *Control) RuntimeStatus(ctx context.Context, user, machine string) (string, string, int64, error) {
	out, err := c.call(ctx, controlRequest{Action: "status", User: user, Machine: machine})
	return out.Status, out.Boot, out.Epoch, err
}

func (c *Control) RuntimeReady(ctx context.Context, user, machine string) (bool, error) {
	out, err := c.call(ctx, controlRequest{Action: "ready", User: user, Machine: machine})
	return out.Ready, err
}

func (c *Control) Disconnect(ctx context.Context, user, machine string) error {
	_, err := c.call(ctx, controlRequest{Action: "disconnect", User: user, Machine: machine})
	return err
}

func (c *Control) RevokeGrant(ctx context.Context, grant string) error {
	_, err := c.call(ctx, controlRequest{Action: "revoke", Grant: grant})
	return err
}

func (c *Control) InvalidateDevice(ctx context.Context, user, machine string, version int64) error {
	_, err := c.call(ctx, controlRequest{Action: "invalidate", User: user, Machine: machine, Version: version})
	return err
}

func (c *Control) Directory() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "http://relay/directory", nil)
		if err != nil {
			fail(r.Context(), w, err)
			return
		}
		req.URL.RawQuery = r.URL.RawQuery
		req.Header.Set("Authorization", r.Header.Get("Authorization"))
		resp, err := c.client.Do(req)
		if err != nil {
			fail(r.Context(), w, err)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})
}

func ListenControl(dir string) (net.Listener, error) {
	path := controlPath(dir)
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(parent)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, errors.New("Relay 控制套接字目录须为权限 0700 的普通目录")
	}
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("Relay 控制套接字路径被占用")
		}
		conn, err := net.DialTimeout("unix", path, time.Second)
		if err == nil {
			conn.Close()
			return nil, errors.New("Relay 控制套接字正在使用")
		}
		if !errors.Is(err, syscall.ECONNREFUSED) && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	return localControlListener{listener}, nil
}

type localControlListener struct{ *net.UnixListener }

func (l localControlListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.AcceptUnix()
		if err != nil {
			return nil, err
		}
		raw, err := conn.SyscallConn()
		if err == nil {
			var allowed bool
			if err := raw.Control(func(fd uintptr) { allowed = controlPeerAllowed(int(fd)) }); err == nil && allowed {
				return conn, nil
			}
		}
		conn.Close()
	}
}

func (s *Service) ControlHandler(revoke func(string)) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /directory", s.identity.RequireAgent(s.Directory()))
	mux.HandleFunc("POST /control", func(w http.ResponseWriter, r *http.Request) {
		var in controlRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil ||
			(in.Action == "revoke" && !validUUID(in.Grant)) ||
			(in.Action != "revoke" && (!validUUID(in.User) || !validUUID(in.Machine))) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var out controlState
		var err error
		switch in.Action {
		case "ready":
			out.Ready, err = s.RuntimeReady(r.Context(), in.User, in.Machine)
		case "status":
			out.Status, out.Boot, out.Epoch, err = s.RuntimeStatus(r.Context(), in.User, in.Machine)
		case "disconnect":
			s.DisconnectRuntime(in.User, in.Machine)
		case "invalidate":
			if in.Version < 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			s.InvalidateDevice(in.User, in.Machine, in.Version)
		case "revoke":
			revoke(in.Grant)
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
	return mux
}
