package skill

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type memoryStorage map[string][]byte

func (s memoryStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s[key] = bytes.Clone(data)
	return nil
}

func (s memoryStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	data, ok := s[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (s memoryStorage) Delete(_ context.Context, key string) error {
	delete(s, key)
	return nil
}

func (s memoryStorage) Ping(context.Context) error { return nil }

func TestServePackageWithoutStore(t *testing.T) {
	p, err := Parse(archive(map[string]string{"SKILL.md": manifest}))
	if err != nil {
		t.Fatal(err)
	}
	storage := memoryStorage{"skills/review.zip": p.Bytes}
	s := NewService(nil, storage)
	o := resource.Object{
		"package_s3_key":     "skills/review.zip",
		"package_file_name":  "review.zip",
		"package_sha256":     p.SHA,
		"package_size_bytes": float64(len(p.Bytes)),
	}
	r := httptest.NewRequest(http.MethodGet, "/package?sha256="+p.SHA, nil)
	w := httptest.NewRecorder()

	s.ServePackage(w, r, o)

	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), p.Bytes) {
		t.Fatalf("技能包响应错误: status=%d size=%d", w.Code, w.Body.Len())
	}
	if w.Header().Get("X-Content-SHA256") != p.SHA || w.Header().Get("Content-Length") == "" {
		t.Fatalf("技能包响应头缺失: %v", w.Header())
	}
}

func TestEditDescription(t *testing.T) {
	p, err := Parse(archive(map[string]string{"SKILL.md": manifest, "scripts/check.sh": "echo ok"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name        string
		description *string
		want        string
	}{
		{name: "omitted", want: "Review"},
		{name: "updated", description: new("新描述"), want: "新描述"},
		{name: "empty", description: new("")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			storage := memoryStorage{"original.zip": p.Bytes}
			s := NewService(nil, storage)
			old := resource.Object{"id": "owned", "package_s3_key": "original.zip", "package_sha256": p.SHA, "package_size_bytes": float64(len(p.Bytes))}
			in := resource.Object{"id": "owned", "name": p.Name, "content": "更新正文\n"}
			if tc.description != nil {
				in["description"] = *tc.description
			}
			err := s.validate(context.Background(), nil, in, old)
			if tc.want == "" {
				if err == nil || len(storage) != 1 {
					t.Fatal("空描述未在上传前拒绝")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			next, err := Parse(storage[in.String("package_s3_key")])
			if err != nil {
				t.Fatal(err)
			}
			if next.Description != tc.want || next.Content != "更新正文\n" || next.SHA == p.SHA || string(next.Files["scripts/check.sh"]) != "echo ok" || next.Front["custom"] != "kept" {
				t.Fatalf("编辑后技能包内容不符合预期: %+v", next)
			}
		})
	}
}
