package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"runtime"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/hostprobe"
)

func TestProbeCommand(t *testing.T) {
	for _, tc := range []struct {
		name      string
		args      []string
		candidate hostprobe.Driver
		want      int
	}{
		{"自动选择", nil, hostprobe.Firecracker, 0},
		{"gVisor回退", []string{"--driver=auto"}, hostprobe.GVisor, 0},
		{"指定驱动", []string{"--driver=firecracker", "--architecture=amd64"}, hostprobe.Firecracker, 0},
		{"已有驱动", []string{"--current-driver=gvisor"}, hostprobe.GVisor, 0},
		{"无候选", nil, "", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out, stderr bytes.Buffer
			code := probeWith(t.Context(), tc.args, &out, &stderr, func(ctx context.Context, c hostprobe.Config) (hostprobe.Report, error) {
				if _, ok := ctx.Deadline(); !ok {
					t.Fatal("缺少超时")
				}
				if tc.args == nil && c.Architecture != runtime.GOARCH {
					t.Fatalf("默认架构应取当前平台：%+v", c)
				}
				return hostprobe.Report{Version: 1, Scope: "platform_only", CandidateDriver: tc.candidate, RequestedDriver: c.Driver, CurrentDriver: c.CurrentDriver}, nil
			})
			if code != tc.want || stderr.Len() != 0 {
				t.Fatalf("code=%d stderr=%s", code, stderr.String())
			}
			var result hostprobe.Report
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Scope != "platform_only" || result.CandidateDriver != tc.candidate || result.ReadinessVerified || result.WorkloadVerified {
				t.Fatalf("报告错误：%s", out.String())
			}
		})
	}
}

func TestProbeInvalidArguments(t *testing.T) {
	for _, args := range [][]string{
		{"--driver=runc"},
		{"--architecture=386"},
		{"--current-driver=auto"},
		{"--current-driver=gvisor", "--driver=firecracker"},
		{"unexpected"},
		{"--unknown"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			called := false
			code := probeWith(t.Context(), args, io.Discard, io.Discard, func(context.Context, hostprobe.Config) (hostprobe.Report, error) {
				called = true
				return hostprobe.Report{}, nil
			})
			if code != 2 || called {
				t.Fatalf("无效参数不应执行探测：code=%d called=%t", code, called)
			}
		})
	}
}

func TestProbeErrors(t *testing.T) {
	var out, stderr bytes.Buffer
	code := probeWith(t.Context(), nil, &out, &stderr, func(context.Context, hostprobe.Config) (hostprobe.Report, error) {
		return hostprobe.Report{}, errors.New("inspect failed")
	})
	if code != 1 || out.Len() != 0 || !strings.Contains(stderr.String(), "inspect failed") {
		t.Fatalf("code=%d out=%s err=%s", code, out.String(), stderr.String())
	}
	code = probeWith(t.Context(), nil, failedWriter{}, io.Discard, func(context.Context, hostprobe.Config) (hostprobe.Report, error) {
		return hostprobe.Report{CandidateDriver: hostprobe.Firecracker}, nil
	})
	if code != 1 {
		t.Fatal("输出失败不能宣称成功")
	}
}

type failedWriter struct{}

func (failedWriter) Write([]byte) (int, error) { return 0, errors.New("write failed") }

func TestProbeDispatch(t *testing.T) {
	var stderr bytes.Buffer
	if code := run(t.Context(), []string{"probe", "--driver=runc"}, io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), "执行引擎必须") {
		t.Fatalf("probe未正确接入入口：code=%d err=%s", code, stderr.String())
	}
}
