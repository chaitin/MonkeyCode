package resource

import (
	"context"
	"io"
	"os"
	"testing"
)

func TestS3RoundTrip(t *testing.T) {
	if os.Getenv("MONKEYAI_TEST_DATABASE_URL") == "" {
		t.Skip("通过集成测试环境启用真实 RustFS 测试")
	}
	ctx := context.Background()
	s, err := NewS3(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Init(ctx); err != nil {
		t.Fatal(err)
	}
	key := "tmp/tests/" + ID()
	data := []byte("RustFS 持久化资源字节\x00\xff")
	if err = s.Put(ctx, key, data, "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	defer s.Delete(ctx, key)
	r, err := s.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(r)
	r.Close()
	if err != nil || string(actual) != string(data) {
		t.Fatal("下载字节与上传不一致")
	}
	if err = s.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if body, err := s.Get(ctx, key); err == nil {
		body.Close()
		t.Fatal("对象删除后仍存在")
	}
}
