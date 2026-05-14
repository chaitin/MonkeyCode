package logging

import (
	"os"
	"strings"
	"testing"
)

func TestLoggerCreatesFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)

	l, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if !strings.HasPrefix(l.Path(), dir) {
		t.Fatalf("log path %q not under %q", l.Path(), dir)
	}
	if _, err := os.Stat(l.Path()); err != nil {
		t.Fatalf("log file not created: %v", err)
	}
}

func TestLoggerPlainWritesToFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)

	l, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if _, err := l.Plain().Write([]byte("hello\n")); err != nil {
		t.Fatal(err)
	}
	if err := l.Sync(); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(l.Path())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "hello") {
		t.Fatalf("log file should contain 'hello', got %q", string(data))
	}
}
