package resource

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"sync"
	"testing"
)

func TestS3Immutable(t *testing.T) {
	if os.Getenv("MONKEYAI_TEST_DATABASE_URL") == "" {
		t.Skip("通过集成测试环境启用真实 S3 不可变对象测试")
	}
	s, err := NewS3(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Init(t.Context()); err != nil {
		t.Fatal(err)
	}
	key := "tmp/tests/immutable/" + ID()
	defer s.Delete(t.Context(), key)
	data := []byte("0123456789immutable-object")
	sum := sha256.Sum256(data)
	sha := "sha256:" + hex.EncodeToString(sum[:])
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Go(func() {
			errs <- s.PutImmutable(t.Context(), key, bytes.NewReader(data), int64(len(data)), "text/plain", sha)
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = s.PutImmutable(t.Context(), key, bytes.NewReader([]byte("wrong")), 5, "text/plain", "sha256:wrong"); err == nil {
		t.Fatal("已存在对象允许覆盖不同内容")
	}
	r, err := s.GetRange(t.Context(), key, 2, 5)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil || string(b) != "2345" {
		t.Fatalf("对象 Range 不正确: %q %v", b, err)
	}
}
