package logger

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
)

type emptyError struct{}

func (emptyError) Error() string { return "" }

func TestReplaceAttrKeepsEmptyErrorVisible(t *testing.T) {
	var buf bytes.Buffer
	l := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{
		ReplaceAttr: replaceAttr,
	}))

	l.Error("failed", "error", emptyError{})

	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal log: %v", err)
	}
	if got["error"] == "" {
		t.Fatal("error attr is empty")
	}
	if got["error"] != "logger.emptyError" {
		t.Fatalf("error attr = %v, want logger.emptyError", got["error"])
	}
}
