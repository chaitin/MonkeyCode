package control

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (c *Client) RegistryAuth(host, reference string) (string, error) {
	server, err := url.Parse(c.Server)
	if err != nil || host == "" {
		return "", errors.New("宿主仓库身份无效")
	}
	registry, repository, ok := strings.Cut(reference, "/")
	if !ok || !strings.EqualFold(registry, server.Host) || !strings.HasPrefix(repository, "environments/") {
		return "", errors.New("环境镜像必须从当前 server 仓库获取")
	}
	expires := time.Now().Add(30 * time.Minute).Unix()
	message := []byte("monkeyai-engine/registry/v1\n" + c.Server + "\n" + host + "\n" + strconv.FormatInt(expires, 10))
	token, err := json.Marshal(struct {
		ExpiresAt int64  `json:"expires_at"`
		Signature []byte `json:"signature"`
	}{expires, ed25519.Sign(c.Key, message)})
	if err != nil {
		return "", err
	}
	auth, err := json.Marshal(map[string]string{"username": host, "password": base64.RawURLEncoding.EncodeToString(token), "serveraddress": server.Host})
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(auth), nil
}
