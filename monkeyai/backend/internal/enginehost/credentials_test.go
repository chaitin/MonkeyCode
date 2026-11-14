package enginehost

import (
	"bytes"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestEnrollmentKeyIsStablePrivateAndSharedAcrossStarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity", "host.key")
	keys := make(chan []byte, 8)
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { key, err := EnrollmentKey(path); keys <- key; errs <- err })
	}
	wg.Wait()
	close(keys)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first []byte
	for key := range keys {
		if len(key) != 32 {
			t.Fatal("签名密钥长度无效")
		}
		if first == nil {
			first = key
		} else if !bytes.Equal(first, key) {
			t.Fatal("并发启动签名身份不一致")
		}
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := EnrollmentKey(path); err == nil {
		t.Fatal("接受公开可读签名密钥")
	}
}
func TestEnrollmentCredentialBindsServerHostVersionAndExpiry(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	s := NewService(nil).WithInstallation("https://server.example", "", "v1").WithEnrollmentKey(key)
	id := resource.ID()
	credential, err := s.credential(id, "v1", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := s.verifyCredential(credential)
	if err != nil || parsed.HostID != id || parsed.Version != "v1" {
		t.Fatal("无法恢复凭证声明", err)
	}
	for _, other := range []*Service{NewService(nil).WithInstallation("https://other.example", "", "v1").WithEnrollmentKey(key), NewService(nil).WithInstallation("https://server.example", "", "v1").WithEnrollmentKey(bytes.Repeat([]byte{8}, 32))} {
		if _, err := other.verifyCredential(credential); err == nil {
			t.Fatal("凭证跨服务端或签名密钥被接受")
		}
	}
	expired, err := s.credential(id, "v1", time.Now().Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.verifyCredential(expired); err == nil {
		t.Fatal("接受过期凭证")
	}
	if _, err = s.verifyCredential(credential + "x"); err == nil {
		t.Fatal("接受篡改凭证")
	}
}
