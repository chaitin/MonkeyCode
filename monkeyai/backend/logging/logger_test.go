package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
)

type hostile struct{}

func (hostile) Error() string        { panic("must not call Error") }
func (hostile) String() string       { panic("must not call String") }
func (hostile) LogValue() slog.Value { panic("must not call LogValue") }

func TestDynamicLevelAndControlEvent(t *testing.T) {
	var output bytes.Buffer
	level := new(slog.LevelVar)
	logger := New(&output, level)
	derived := logger.With("module", "test").WithGroup("worker")
	derived.Debug("hidden")
	level.Set(slog.LevelDebug)
	derived.Debug("visible")
	level.Set(slog.LevelError)
	derived.Info("hidden")
	if err := LevelChanged(t.Context(), logger, slog.LevelInfo, slog.LevelError); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	if strings.Contains(text, "hidden") || !strings.Contains(text, "visible") || !strings.Contains(text, "logging.level.changed") {
		t.Fatal(text)
	}
	if !strings.Contains(text, `"file":"logger_test.go"`) {
		t.Fatal("source not preserved:", text)
	}
}

func TestSafetyBeforeJSONResolution(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, slog.LevelDebug)
	logger.With("config", hostile{}, "module", "test").Error("safe", "error", hostile{}, "object", hostile{},
		"token", "private-token", "url", "https://user:password@example.test/path?key=secret",
		"reason", "failed with private message", "files", []string{"private-file"})
	text := output.String()
	for _, secret := range []string{"private-token", "password", "example.test", "private message", "private-file"} {
		if strings.Contains(text, secret) {
			t.Fatalf("leaked %q: %s", secret, text)
		}
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	logger.Error("wrapped", "error", &url.Error{Op: "get", URL: "https://private.test?token=secret", Err: errors.New("private response")})
	if records(t, &output)[1]["error"].(map[string]any)["error_message"] != `get "https://private.test?token=secret": private response` {
		t.Fatal(output.String())
	}
}

func TestRuntimeAdapterPreservesError(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, slog.LevelInfo)
	ErrorLog(logger).Print("panic secret https://private.test?token=hidden")
	if records(t, &output)[0]["error_message"] != "panic secret https://private.test?token=hidden\n" || !strings.Contains(output.String(), "runtime.http.error") {
		t.Fatal(output.String())
	}
	attrs := ErrorAttrs(context.DeadlineExceeded)
	if attrs[0].Value.String() != "deadline_exceeded" {
		t.Fatal(attrs)
	}
}

func TestErrorAttrsPreservesMessages(t *testing.T) {
	_ = ErrorAttrs(hostile{})
	for _, test := range []struct {
		cause error
		code  string
	}{
		{syscall.EROFS, "read_only_filesystem"},
		{syscall.ENOSPC, "disk_full"},
		{os.ErrPermission, "permission_denied"},
		{os.ErrNotExist, "not_found"},
	} {
		var output bytes.Buffer
		logger := New(&output, slog.LevelInfo)
		err := &os.PathError{Op: "private-operation", Path: "private-file", Err: test.cause}
		logger.Error("safe", "error", err)
		if !strings.Contains(output.String(), test.code) || records(t, &output)[0]["error"].(map[string]any)["error_message"] != err.Error() {
			t.Fatal(output.String())
		}
	}
}

func testLogger() (*slog.Logger, *bytes.Buffer) {
	output := new(bytes.Buffer)
	return New(output, slog.LevelDebug), output
}

func records(t *testing.T, output *bytes.Buffer) []map[string]any {
	t.Helper()
	var result []map[string]any
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	for {
		var row map[string]any
		err := decoder.Decode(&row)
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, row)
	}
}

func TestRepeatedErrorsPreserveEveryOccurrence(t *testing.T) {
	logger, output := testLogger()
	logger = logger.With("module", "proxy").WithGroup("call")
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Go(func() {
			err := fmt.Errorf("请求 %d: %w", i, io.ErrUnexpectedEOF)
			Event(t.Context(), logger, slog.LevelError, "model.call.completed", "模型调用失败",
				"model_id", "m1", "operation", "proxy_request", "request_id", fmt.Sprintf("r%d", i), "error", err)
		})
	}
	wg.Wait()
	rows := records(t, output)
	if len(rows) != 100 {
		t.Fatalf("错误被合并: %d", len(rows))
	}
	seen := make(map[string]bool)
	for _, row := range rows {
		call := row["call"].(map[string]any)
		id := call["request_id"].(string)
		if seen[id] {
			t.Fatalf("重复请求: %s", id)
		}
		seen[id] = true
		expected := fmt.Sprintf("请求 %s: unexpected EOF", strings.TrimPrefix(id, "r"))
		if call["event"] != "model.call.completed" || call["error"].(map[string]any)["error_message"] != expected {
			t.Fatalf("错误详情丢失: %v", row)
		}
	}
}

func TestErrorMessagesSurviveAllEntryPoints(t *testing.T) {
	message := "数据库查询失败：" + strings.Repeat("column does not exist; ", 20) + "\n原始错误"
	for _, test := range []struct {
		name string
		log  func(*slog.Logger)
	}{
		{"诊断", func(logger *slog.Logger) {
			Diagnostic(t.Context(), logger, slog.LevelError, "resource.operation.failed", errors.New(message))
		}},
		{"错误属性", func(logger *slog.Logger) {
			logger.LogAttrs(t.Context(), slog.LevelError, "失败", ErrorAttrs(errors.New(message))...)
		}},
		{"文本属性", func(logger *slog.Logger) { logger.Error("失败", "error_message", message) }},
		{"派生属性", func(logger *slog.Logger) { logger.With("error_message", message).Error("失败") }},
	} {
		t.Run(test.name, func(t *testing.T) {
			logger, output := testLogger()
			test.log(logger)
			if records(t, output)[0]["error_message"] != message {
				t.Fatal("错误文本被过滤或截断")
			}
		})
	}
}

type brokenOutput struct{}

func (brokenOutput) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestOutputFailureFallsBackToStderr(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "stderr")
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stderr
	os.Stderr = file
	t.Cleanup(func() {
		os.Stderr = original
		if err := file.Close(); err != nil {
			t.Error(err)
		}
	})
	New(brokenOutput{}, slog.LevelDebug).Error("业务失败", "error", errors.New("数据库不可用"))
	Event(t.Context(), slog.New(slog.NewJSONHandler(brokenOutput{}, nil)), slog.LevelError, "test.failed", "业务失败")
	content, err := os.ReadFile(file.Name())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(content), io.ErrClosedPipe.Error()) != 2 {
		t.Fatalf("日志输出错误被忽略: %s", content)
	}
}
