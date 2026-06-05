package agentresource

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

// buildZip is a tiny helper that produces an in-memory zip with the given
// entries. Used by both unpack_test.go and resolver_test.go.
func buildZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func TestUnzipToMemory_HappyPath(t *testing.T) {
	data := buildZip(t, map[string]string{
		"skill.md":       "# hello",
		"scripts/run.sh": "#!/bin/sh",
		"docs/notes.txt": "n",
	})
	files, err := unzipToMemory(data, DefaultUnzipLimits)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(files) != 3 {
		t.Fatalf("want 3 files, got %d", len(files))
	}
	got := map[string]string{}
	for _, f := range files {
		got[f.RelPath] = string(f.Content)
	}
	if got["skill.md"] != "# hello" {
		t.Errorf("skill.md content = %q", got["skill.md"])
	}
	if got["scripts/run.sh"] != "#!/bin/sh" {
		t.Errorf("scripts/run.sh content = %q", got["scripts/run.sh"])
	}
}

func TestUnzipToMemory_RejectsZipSlip(t *testing.T) {
	data := buildZip(t, map[string]string{
		"../evil.sh": "rm -rf /",
	})
	_, err := unzipToMemory(data, DefaultUnzipLimits)
	if err == nil {
		t.Fatal("expected zip-slip rejection, got nil")
	}
	if !strings.Contains(err.Error(), "zip-slip") {
		t.Errorf("err = %v, want zip-slip", err)
	}
}

func TestUnzipToMemory_RejectsAbsolutePath(t *testing.T) {
	data := buildZip(t, map[string]string{
		"/etc/passwd": "x",
	})
	_, err := unzipToMemory(data, DefaultUnzipLimits)
	if err == nil {
		t.Fatal("expected absolute-path rejection")
	}
}

func TestUnzipToMemory_FileTooBig(t *testing.T) {
	big := strings.Repeat("A", 100)
	data := buildZip(t, map[string]string{"a.txt": big})
	limits := UnzipLimits{MaxFileSize: 10, MaxTotalSize: 1000, MaxFiles: 10}
	_, err := unzipToMemory(data, limits)
	if err == nil {
		t.Fatal("expected per-file limit rejection")
	}
}

func TestUnzipToMemory_TooManyFiles(t *testing.T) {
	entries := map[string]string{}
	for i := 0; i < 5; i++ {
		entries[string(rune('a'+i))+".txt"] = "x"
	}
	data := buildZip(t, entries)
	limits := UnzipLimits{MaxFileSize: 1000, MaxTotalSize: 1000, MaxFiles: 3}
	_, err := unzipToMemory(data, limits)
	if err == nil {
		t.Fatal("expected file-count rejection")
	}
}

func TestUnzipToMemory_SkipsDirectories(t *testing.T) {
	// Use a raw zip writer to add an explicit directory entry, which the
	// helper map can't easily represent.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if _, err := zw.Create("subdir/"); err != nil {
		t.Fatalf("create dir: %v", err)
	}
	w, err := zw.Create("subdir/file.txt")
	if err != nil {
		t.Fatalf("create file: %v", err)
	}
	_, _ = w.Write([]byte("ok"))
	_ = zw.Close()

	files, err := unzipToMemory(buf.Bytes(), DefaultUnzipLimits)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(files) != 1 || files[0].RelPath != "subdir/file.txt" {
		t.Fatalf("unexpected files: %+v", files)
	}
}

func TestUnzipToMemory_RejectsBackslash(t *testing.T) {
	data := buildZip(t, map[string]string{
		`win\path.txt`: "x",
	})
	_, err := unzipToMemory(data, DefaultUnzipLimits)
	if err == nil {
		t.Fatal("expected backslash rejection")
	}
}
