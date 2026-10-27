package videogen

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"syscall"
	"testing"
	"testing/iotest"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

type failedVideoStorage struct {
	videoStorage
	err error
}

func (s failedVideoStorage) PutReader(context.Context, string, io.ReadSeeker, int64, string) error {
	return s.err
}

func TestOutputFailureDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name              string
		status            int
		expected          int64
		body              string
		readErr, storeErr error
		phase, code       string
	}{
		{name: "下载被拒绝", status: 403, expected: -1, phase: "download_response", code: "video_output_http_error"},
		{name: "下载地址重定向", status: 302, expected: -1, phase: "download_response", code: "video_output_http_error"},
		{name: "下载服务异常", status: 502, expected: -1, phase: "download_response", code: "video_output_http_error"},
		{name: "响应声明超限", status: 200, expected: maxOutputBytes + 1, phase: "download_response", code: "video_output_too_large"},
		{name: "响应声明为空", status: 200, expected: 0, phase: "download_response", code: "video_output_empty"},
		{name: "未知长度空响应", status: 200, expected: -1, phase: "download_body", code: "video_output_empty"},
		{name: "下载长度不符", status: 200, expected: 100, body: "mp4", phase: "download_body", code: "video_output_incomplete"},
		{name: "下载超时", status: 200, expected: 100, body: "mp4", readErr: context.DeadlineExceeded, phase: "download_body", code: "deadline_exceeded"},
		{name: "连接中断", status: 200, expected: 100, body: "mp4", readErr: syscall.ECONNRESET, phase: "download_body", code: "connection_reset"},
		{name: "下载流磁盘错误", status: 200, expected: 100, body: "mp4", readErr: syscall.ENOSPC, phase: "download_body", code: "disk_full"},
		{name: "流式存储未配置", status: 200, expected: 3, body: "mp4", phase: "store_object", code: "video_output_storage_unavailable"},
		{name: "对象存储失败", status: 200, expected: -1, body: "mp4", storeErr: context.DeadlineExceeded, phase: "store_object", code: "deadline_exceeded"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("TMPDIR", dir)
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(logging.New(&logs, slog.LevelWarn))
			t.Cleanup(func() { slog.SetDefault(previous) })
			var reader io.Reader = strings.NewReader(tc.body)
			if tc.readErr != nil {
				reader = io.MultiReader(reader, iotest.ErrReader(tc.readErr))
			}
			body := &trackedVideoBody{Reader: reader}
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, ContentLength: tc.expected, Body: body}, nil
			})}
			service := &Service{}
			if tc.storeErr != nil {
				service.storage = failedVideoStorage{err: tc.storeErr}
			}
			_, err := service.saveOutput(t.Context(), client, "job-1", "https://private-host.example/video.mp4?token=private-token", 6000)
			if err == nil {
				t.Fatal("应返回保存错误")
			}
			for _, cause := range []error{tc.readErr, tc.storeErr} {
				if cause != nil && !errors.Is(err, cause) {
					t.Fatalf("原始错误丢失: %v", err)
				}
			}
			logPollFailure(t.Context(), "video.job.retry", "处理视频任务失败，等待重试", "job-1", 1,
				&processFailure{phase: "save_output", proxy: true, err: err})
			var row struct {
				Phase    string `json:"phase"`
				Proxy    bool   `json:"proxy_used"`
				Status   int    `json:"upstream_status"`
				Expected int64  `json:"expected_bytes"`
				Output   struct {
					Phase    string `json:"phase"`
					Expected int64  `json:"expected_bytes"`
					Received int64  `json:"received_bytes"`
				} `json:"output"`
				Error struct {
					Code string `json:"error_code"`
				} `json:"error"`
			}
			lines := bytes.Split(bytes.TrimSpace(logs.Bytes()), []byte("\n"))
			if err := json.Unmarshal(lines[len(lines)-1], &row); err != nil {
				t.Fatal(err)
			}
			if row.Phase != "save_output" || !row.Proxy || row.Output.Phase != tc.phase || row.Error.Code != tc.code {
				t.Fatalf("日志缺少故障阶段或分类: %s", logs.String())
			}
			if tc.phase == "download_response" {
				if row.Status != tc.status || row.Expected != tc.expected {
					t.Fatalf("日志缺少响应诊断: %s", logs.String())
				}
			} else if row.Output.Expected != tc.expected || row.Output.Received != int64(len(tc.body)) {
				t.Fatalf("日志缺少下载字节数: %s", logs.String())
			}
			if strings.Contains(logs.String(), "private-") {
				t.Fatalf("日志泄露下载地址: %s", logs.String())
			}
			if !body.closed {
				t.Error("失败后未关闭响应流")
			}
			files, err := os.ReadDir(dir)
			if err != nil || len(files) != 0 {
				t.Fatalf("失败后未清理临时文件: %v, %v", files, err)
			}
		})
	}
}

type trackedVideoBody struct {
	io.Reader
	closed bool
}

func (b *trackedVideoBody) Close() error { b.closed = true; return nil }

func TestInvalidOutputURLDiagnostics(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("无效地址不应发送请求")
		return nil, nil
	})}
	for _, address := range []string{"", "http://example.com/video.mp4", "https://user:password@example.com/video.mp4", "https://example.com/video.mp4#fragment"} {
		_, err := (&Service{}).saveOutput(t.Context(), client, "job-1", address, 6000)
		if !errors.Is(err, errOutputURL) {
			t.Fatalf("无效地址未正确分类: %v", err)
		}
	}
}
