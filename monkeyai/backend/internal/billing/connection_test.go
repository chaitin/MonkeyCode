package billing

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	auditlog "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"github.com/go-chi/chi/v5"
)

func walletFixture(t *testing.T, expires time.Time) WalletConfig {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "测试 CA"}, NotBefore: time.Now().Add(-48 * time.Hour), NotAfter: time.Now().Add(48 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "测试应用"}, NotBefore: time.Now().Add(-24 * time.Hour), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return WalletConfig{Environment: "dev", AppID: 4, Certificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private})), CACertificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: root}))}
}

func TestWalletCertificates(t *testing.T) {
	cfg := walletFixture(t, time.Now().Add(time.Hour))
	other := walletFixture(t, time.Now().Add(time.Hour))
	for _, tc := range []struct {
		name   string
		change func(*WalletConfig)
	}{
		{"环境", func(v *WalletConfig) { v.Environment = "local" }},
		{"应用 ID", func(v *WalletConfig) { v.AppID = 0 }},
		{"应用 ID 上限", func(v *WalletConfig) { v.AppID = 1000 }},
		{"缺少私钥", func(v *WalletConfig) { v.PrivateKey = "" }},
		{"无效证书", func(v *WalletConfig) { v.Certificate = "invalid" }},
		{"私钥不匹配", func(v *WalletConfig) { v.PrivateKey = other.PrivateKey }},
		{"无效 CA", func(v *WalletConfig) { v.CACertificate = "invalid" }},
		{"非 CA", func(v *WalletConfig) { v.CACertificate = v.Certificate }},
		{"文件过大", func(v *WalletConfig) { v.CACertificate = strings.Repeat("a", 64<<10+1) }},
		{"证书过期", func(v *WalletConfig) { *v = walletFixture(t, time.Now().Add(-time.Hour)) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := cfg
			tc.change(&next)
			if _, err := newWallet(next); err == nil {
				t.Fatal("无效配置未被拒绝")
			}
		})
	}
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	wallet, err := newWallet(cfg)
	if err != nil || !wallet.ready() {
		t.Fatal("有效配置初始化失败", err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatal("证书临时文件未清理", err)
	}
	wallet.validUntil = time.Now().Add(-time.Second)
	if wallet.ready() || wallet.info().Error == "" {
		t.Fatal("证书过期后仍允许调用")
	}
	for name, content := range map[string]string{"app.crt": cfg.Certificate, "app.key": cfg.PrivateKey, "ca.crt": cfg.CACertificate} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("BAIZHIYUN_ENV", "dev")
	t.Setenv("BAIZHIYUN_APP_ID", "4")
	t.Setenv("MONKEYAI_WALLET_CERT_DIR", dir)
	wallet, err = WalletFromEnv()
	if err != nil || !wallet.ready() || wallet.info().Source != "environment" {
		t.Fatal("部署配置不兼容", err)
	}
}

func walletAdmin(t *testing.T, s *Service, user string) func(string, string, any, int) []byte {
	t.Helper()
	token := "wallet-settings-test"
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(t.Context(), `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), user)
	if err != nil {
		t.Fatal(err)
	}
	settings := setting.NewService(setting.NewPostgres(s.pool))
	identities := identity.NewService(s.pool, settings, "http://localhost", "http://localhost")
	router := chi.NewRouter()
	router.Use(identities.RequireAdmin)
	router.Use(auditlog.NewService(s.pool, slog.New(slog.NewTextHandler(io.Discard, nil))).Middleware(func(r *http.Request) auditlog.Actor {
		u, _ := identity.UserFromContext(r.Context())
		return auditlog.Actor{ID: u.ID, Name: u.Name, Email: u.Email}
	}))
	s.RegisterAdmin(router)
	settings.RegisterAdmin(router)
	return func(method, path string, input any, status int) []byte {
		t.Helper()
		raw, _ := json.Marshal(input)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		if status != 401 {
			r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: 状态 %d，期望 %d，响应 %s", method, path, w.Code, status, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "BEGIN ") {
			t.Fatal("响应泄漏证书内容")
		}
		return w.Body.Bytes()
	}
}

func TestWalletSettings(t *testing.T) {
	s, user, _ := fixture(t)
	call := walletAdmin(t, s, user)
	cfg := walletFixture(t, time.Now().Add(time.Hour))
	input := map[string]any{"revision": 1, "environment": cfg.Environment, "app_id": cfg.AppID, "certificate": cfg.Certificate, "private_key": cfg.PrivateKey, "ca_certificate": cfg.CACertificate}
	call("PATCH", "/billing/settings/wallet", input, 401)
	call("PATCH", "/billing/settings/mode", map[string]any{"revision": 1, "charging_mode": "remote", "enabled": true}, 422)
	var out struct {
		Policy Policy     `json:"policy"`
		Wallet WalletInfo `json:"wallet"`
	}
	if err := json.Unmarshal(call("PATCH", "/billing/settings/wallet", input, 200), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Wallet.Configured || !out.Wallet.CredentialsConfigured || out.Policy.Revision != 2 || out.Wallet.Source != "admin" {
		t.Fatal("保存后状态错误")
	}
	original, err := s.walletConfig(t.Context(), s.pool)
	if err != nil {
		t.Fatal(err)
	}
	call("PATCH", "/billing/settings/wallet", input, 409)
	call("PATCH", "/billing/settings/pricing", map[string]any{"revision": 2, "input_credits_per_million_tokens": "101", "cached_input_credits_per_million_tokens": "21", "output_credits_per_million_tokens": "401"}, 200)
	call("PATCH", "/billing/settings/wallet", map[string]any{"revision": 3, "environment": "dev", "app_id": 4, "private_key": "invalid"}, 400)
	call("PATCH", "/billing/settings/wallet", map[string]any{"revision": 3, "environment": "dev", "app_id": 4, "private_key": nil}, 400)
	call("PATCH", "/billing/settings/wallet", map[string]any{"revision": 3, "environment": "dev", "app_id": 4, "unknown": "value"}, 400)
	call("PATCH", "/billing/settings/wallet", map[string]any{"revision": 3, "environment": "dev", "app_id": 4, "certificate": "", "private_key": "", "ca_certificate": ""}, 200)
	stored, err := s.walletConfig(t.Context(), s.pool)
	if err != nil || *stored != *original {
		t.Fatal("独立保存覆盖了证书或未保留留空字段", err)
	}
	t.Setenv("BAIZHIYUN_ENV", "invalid")
	restarted := NewService(s.pool)
	if err = restarted.Initialize(t.Context()); err != nil {
		t.Fatal("后台配置未优先于环境变量", err)
	}
	wallet, err := restarted.wallet(t.Context(), s.pool)
	if err != nil || !wallet.ready() || wallet.AppID != 4 {
		t.Fatal("重启后未恢复配置", err)
	}
	call("PATCH", "/billing/settings/wallet", map[string]any{"revision": 4, "environment": "prod", "app_id": 5}, 200)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			wallet, err := restarted.wallet(t.Context(), s.pool)
			if err != nil || !wallet.ready() || wallet.AppID != 5 || wallet.Environment != "prod" {
				t.Error("其他实例未读取最新配置", err)
			}
		})
	}
	wg.Wait()
	call("PATCH", "/billing/settings/mode", map[string]any{"revision": 5, "charging_mode": "remote", "enabled": true}, 200)
	call("GET", "/billing/settings", nil, 200)
	call("PATCH", "/billing/settings/cycle", map[string]any{"revision": 6, "quota_refresh_cycle": "daily"}, 200)
	call("PATCH", "/billing/settings/cycle", map[string]any{"revision": 7, "quota_refresh_cycle": "monthly"}, 200)
	policy, err := s.Policy(t.Context())
	if err != nil || policy.PendingCycle != "" || policy.CycleEffectiveAt != nil {
		t.Fatal("保留钱包配置时未清除已撤销的待生效周期", err)
	}
	for _, path := range []string{"/settings", "/settings/billing"} {
		if strings.Contains(string(call("GET", path, nil, 200)), "\"wallet\"") {
			t.Fatal("通用设置返回钱包配置")
		}
	}
	agent, err := setting.NewService(setting.NewPostgres(s.pool)).AgentConfig(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(agent)
	if strings.Contains(string(raw), "wallet") || strings.Contains(string(raw), "BEGIN ") {
		t.Fatal("Agent 配置泄漏钱包信息")
	}
	var logs []byte
	if err = s.pool.QueryRow(t.Context(), `SELECT COALESCE(jsonb_agg(request_params),'[]') FROM audits`).Scan(&logs); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(logs), "BEGIN ") || !strings.Contains(string(logs), "REDACTED") {
		t.Fatal("审计未脱敏")
	}
}

func TestWalletSettingsProtectPendingTransactions(t *testing.T) {
	s, user, model := fixture(t)
	s.WithWallet(&Wallet{Client: &walletStub{}, Environment: "dev", AppID: 4})
	if err := s.BindWallet(t.Context(), user, user, "1001"); err != nil {
		t.Fatal(err)
	}
	p := defaultPolicy()
	p.Enabled, p.Mode = true, "remote"
	setPolicy(t, s, p)
	if _, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model"}); err != nil {
		t.Fatal(err)
	}
	call := walletAdmin(t, s, user)
	cfg := walletFixture(t, time.Now().Add(time.Hour))
	input := map[string]any{"revision": 1, "environment": "prod", "app_id": cfg.AppID, "certificate": cfg.Certificate, "private_key": cfg.PrivateKey, "ca_certificate": cfg.CACertificate}
	call("PATCH", "/billing/settings/wallet", input, 409)
	input["environment"], input["app_id"] = "dev", 5
	call("PATCH", "/billing/settings/wallet", input, 409)
	input["app_id"] = 4
	call("PATCH", "/billing/settings/wallet", input, 200)
}
