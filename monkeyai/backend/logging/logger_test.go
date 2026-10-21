package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"os"
	"strings"
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
	if strings.Contains(output.String(), "private.test") || strings.Contains(output.String(), "private response") {
		t.Fatal(output.String())
	}
}

func TestSafeRuntimeAdapter(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, slog.LevelInfo)
	ErrorLog(logger).Print("panic secret https://private.test?token=hidden")
	if strings.Contains(output.String(), "secret") || !strings.Contains(output.String(), "runtime.http.error") {
		t.Fatal(output.String())
	}
	attrs := ErrorAttrs(context.DeadlineExceeded)
	if attrs[0].Value.String() != "deadline_exceeded" {
		t.Fatal(attrs)
	}
}

func TestErrorAttrsDoNotFormatErrors(t *testing.T) {
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
		if !strings.Contains(output.String(), test.code) || strings.Contains(output.String(), "private-") {
			t.Fatal(output.String())
		}
	}
}
