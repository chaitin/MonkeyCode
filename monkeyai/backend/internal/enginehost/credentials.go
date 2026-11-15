package enginehost

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
)

// 服务器级签名密钥持久化，避免重启使尚未过期的接入凭证失效。
func EnrollmentKey(path string) ([]byte, error) {
	read := func() ([]byte, error) {
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("宿主凭证签名文件权限无效")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if len(raw) != 32 {
			return nil, errors.New("宿主凭证签名文件损坏")
		}
		return raw, nil
	}
	if key, err := read(); !errors.Is(err, os.ErrNotExist) {
		return key, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".host-key-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(key); err != nil {
		return nil, err
	}
	if err = file.Sync(); err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	if err = os.Link(file.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	if err = dir.Sync(); err != nil {
		return nil, err
	}
	return read()
}
func (s *Service) WithEnrollmentKey(key []byte) *Service {
	s.enrollmentKey = append([]byte(nil), key...)
	return s
}

type enrollmentClaims struct {
	HostID    string `json:"host_id"`
	Version   string `json:"version"`
	ExpiresAt int64  `json:"expires_at"`
}

func (s *Service) credentialMAC(payload string) []byte {
	mac := hmac.New(sha256.New, s.enrollmentKey)
	mac.Write([]byte("monkeyai-engine/enrollment/v2\n" + s.server + "\n" + payload))
	return mac.Sum(nil)
}
func (s *Service) credential(id, version string, until time.Time) (string, error) {
	if len(s.enrollmentKey) != 32 {
		return "", errors.New("宿主接入凭证签名未配置")
	}
	raw, _ := json.Marshal(enrollmentClaims{id, version, until.Unix()})
	body := base64.RawURLEncoding.EncodeToString(raw)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.credentialMAC(body)), nil
}
func (s *Service) verifyCredential(value string) (enrollmentClaims, error) {
	var out enrollmentClaims
	if len(value) > 2048 || len(s.enrollmentKey) != 32 {
		return out, errors.New("接入凭证无效")
	}
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return out, errors.New("接入凭证无效")
	}
	sig, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil || !hmac.Equal(sig, s.credentialMAC(parts[0])) {
		return out, errors.New("接入凭证签名无效")
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil || json.Unmarshal(raw, &out) != nil || !idPattern.MatchString(out.HostID) || !versionPattern.MatchString(out.Version) || out.ExpiresAt <= time.Now().Unix() || out.ExpiresAt > time.Now().Add(31*time.Minute).Unix() {
		return out, errors.New("接入凭证已过期或无效")
	}
	return out, nil
}
func (s *Service) installationVersion(ctx context.Context, value string) (string, error) {
	claims, err := s.verifyCredential(value)
	if err != nil {
		return "", err
	}
	host, err := sqlc.New(s.pool).InstallationHost(ctx, claims.HostID)
	if err != nil {
		return "", err
	}
	if host.Version != claims.Version {
		return "", errors.New("接入目标版本已变化")
	}
	return claims.Version, nil
}
func validReportTime(at, now time.Time) bool {
	return !at.IsZero() && !at.Before(now.Add(-time.Minute)) && !at.After(now.Add(5*time.Second))
}
