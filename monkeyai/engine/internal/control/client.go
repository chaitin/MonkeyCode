package control

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	Insecure     bool   `json:"insecure,omitempty"`
	Server       string `json:"server"`
	HostID       string `json:"host_id"`
	Architecture string `json:"architecture"`
	Version      string `json:"version"`
	DataDir      string `json:"data_dir"`
}
type Client struct {
	Server  string
	Key     ed25519.PrivateKey
	HTTP    *http.Client
	Upgrade *UpgradeTask
}

func New(server string, key ed25519.PrivateKey) (*Client, error) {
	if err := ValidateServer(server); err != nil {
		return nil, err
	}
	if len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("宿主密钥无效")
	}
	return &Client{Server: strings.TrimRight(server, "/"), Key: key, HTTP: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("拒绝重定向") }}}, nil
}
func (c *Client) WithInsecure(insecure bool) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: insecure} // 由安装参数显式选择，兼容 IP 和自签名证书。
	c.HTTP.Transport = transport
	return c
}
func ValidateServer(server string) error {
	u, err := url.Parse(server)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(server, "\r\n\x00") {
		return errors.New("后台地址必须为无凭据的 HTTP 或 HTTPS 根地址")
	}
	return nil
}
func Digest(data []byte) string { v := sha256.Sum256(data); return hex.EncodeToString(v[:]) }

var ErrUnauthorized = errors.New("宿主认证失效或已被撤销")

func (c *Client) post(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.Server+"/api/host/v1/"+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("连接后台失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return ErrUnauthorized
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("后台请求失败，状态码 %d", resp.StatusCode)
	}
	d := json.NewDecoder(io.LimitReader(resp.Body, 64<<10))
	return d.Decode(out)
}
func (c *Client) Enroll(ctx context.Context, token, arch, version string) (string, error) {
	name, err := os.Hostname()
	if err != nil {
		return "", err
	}
	if len(name) > 128 {
		name = name[:128]
	}
	message := []byte("monkeyai-engine/enroll/v1\n" + c.Server + "\n" + token + "\n" + arch + "\n" + version + "\n" + name)
	var out struct {
		HostID string `json:"host_id"`
	}
	err = c.post(ctx, "enroll", map[string]any{"name": name, "token": token, "public_key": []byte(c.Key.Public().(ed25519.PublicKey)), "signature": ed25519.Sign(c.Key, message), "architecture": arch, "version": version}, &out)
	if err == nil && out.HostID == "" {
		err = errors.New("后台未返回宿主标识")
	}
	return out.HostID, err
}
func (c *Client) timestamp(ctx context.Context) (time.Time, error) {
	var out struct {
		At time.Time `json:"at"`
	}
	if err := c.post(ctx, "time", struct{}{}, &out); err != nil {
		return time.Time{}, err
	}
	if out.At.IsZero() {
		return time.Time{}, errors.New("后台时间无效")
	}
	return out.At, nil
}
func (c *Client) Heartbeat(ctx context.Context, id string, report any) error {
	at, err := c.timestamp(ctx)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return err
	}
	message := []byte("monkeyai-engine/heartbeat/v2\n" + c.Server + "\n" + id + "\n" + at.UTC().Format(time.RFC3339Nano) + "\n" + Digest(raw))
	var out struct {
		Accepted bool         `json:"accepted"`
		Upgrade  *UpgradeTask `json:"upgrade"`
	}
	if err := c.post(ctx, "heartbeat", map[string]any{"host_id": id, "at": at, "report": json.RawMessage(raw), "signature": ed25519.Sign(c.Key, message)}, &out); err != nil {
		return err
	}
	c.Upgrade = nil
	if !out.Accepted {
		return errors.New("后台拒绝宿主报告")
	}
	c.Upgrade = out.Upgrade
	return nil
}
func Key(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err == nil {
		info, e := os.Lstat(path)
		if e != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || len(raw) != ed25519.SeedSize {
			return nil, errors.New("宿主私钥文件损坏或权限无效")
		}
		return ed25519.NewKeyFromSeed(raw), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	if _, err = f.Write(key.Seed()); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return nil, err
	}
	return key, nil
}
func Write(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".write-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(mode); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (c *Client) Exchange(ctx context.Context, id string, payload any, out any) error {
	at, err := c.timestamp(ctx)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	message := []byte("monkeyai-engine/exchange/v2\n" + c.Server + "\n" + id + "\n" + at.UTC().Format(time.RFC3339Nano) + "\n" + Digest(raw))
	return c.post(ctx, "exchange", map[string]any{"host_id": id, "at": at, "payload": json.RawMessage(raw), "signature": ed25519.Sign(c.Key, message)}, out)
}
