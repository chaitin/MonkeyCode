package billing

import (
	"context"
	"crypto/ecdsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"git.in.chaitin.net/ai/baizhiyun/opensdk"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type WalletConfig struct {
	BaseURL       string `json:"base_url"`
	AppID         int    `json:"app_id"`
	Certificate   string `json:"certificate"`
	PrivateKey    string `json:"private_key"`
	CACertificate string `json:"ca_certificate"`
}

type WalletInfo struct {
	Configured            bool       `json:"configured"`
	CredentialsConfigured bool       `json:"credentials_configured"`
	BaseURL               string     `json:"base_url,omitempty"`
	AppID                 int        `json:"app_id,omitempty"`
	CertificateExpiresAt  *time.Time `json:"certificate_expires_at,omitempty"`
	Source                string     `json:"source,omitempty"`
	Error                 string     `json:"error,omitempty"`
}

func WalletFromEnv() (*Wallet, error) {
	cfg := WalletConfig{BaseURL: os.Getenv("BAIZHIYUN_BASE_URL")}
	if cfg.BaseURL == "" {
		switch os.Getenv("BAIZHIYUN_ENV") {
		case "":
			return nil, nil
		case "dev":
			cfg.BaseURL = "https://baizhiyun.vip"
		case "prod":
			cfg.BaseURL = "https://baizhi.cloud"
		default:
			return nil, resource.Invalid("请配置百智云服务 URL")
		}
	}
	cfg.AppID, _ = strconv.Atoi(os.Getenv("BAIZHIYUN_APP_ID"))
	dir := os.Getenv("MONKEYAI_WALLET_CERT_DIR")
	if dir == "" {
		return nil, errors.New("远程计费需配置 MONKEYAI_WALLET_CERT_DIR")
	}
	for name, target := range map[string]*string{"app.crt": &cfg.Certificate, "app.key": &cfg.PrivateKey, "ca.crt": &cfg.CACertificate} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, fmt.Errorf("读取钱包证书文件 %s 失败", name)
		}
		*target = string(data)
	}
	w, err := newWallet(cfg)
	if err == nil {
		w.source = "environment"
	}
	return w, err
}

func newWallet(cfg WalletConfig) (*Wallet, error) {
	var err error
	cfg.BaseURL, err = normalizeWalletURL(cfg.BaseURL)
	if err != nil {
		return nil, resource.Invalid("百智云服务 URL：" + err.Error())
	}
	if cfg.AppID < 1 || cfg.AppID > 999 {
		return nil, resource.Invalid("应用 ID 必须在 1 到 999 之间")
	}
	for _, data := range []string{cfg.Certificate, cfg.PrivateKey, cfg.CACertificate} {
		if len(data) == 0 || len(data) > 64<<10 {
			return nil, resource.Invalid("请提供客户端证书、私钥和 CA 证书，每项不能超过 64 KiB")
		}
	}
	pair, err := tls.X509KeyPair([]byte(cfg.Certificate), []byte(cfg.PrivateKey))
	if err != nil {
		return nil, resource.Invalid("客户端证书或私钥格式无效，或证书与私钥不匹配")
	}
	block, _ := pem.Decode([]byte(cfg.PrivateKey))
	if block == nil {
		return nil, resource.Invalid("私钥格式无效")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if _, ok := key.(*ecdsa.PrivateKey); err != nil || !ok {
		return nil, resource.Invalid("百智云私钥必须为 PKCS#8 格式的 ECDSA 私钥（BEGIN PRIVATE KEY）")
	}
	cert, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, resource.Invalid("客户端证书格式无效")
	}
	if time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
		return nil, resource.Invalid("客户端证书不在有效期内")
	}
	validUntil := cert.NotAfter
	data := []byte(strings.TrimSpace(cfg.CACertificate))
	count := 0
	for len(data) > 0 {
		block, rest := pem.Decode(data)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, resource.Invalid("CA 证书必须为 PEM 格式")
		}
		ca, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !ca.IsCA {
			return nil, resource.Invalid("CA 证书无效或不具备 CA 签发用途")
		}
		if time.Now().Before(ca.NotBefore) || !time.Now().Before(ca.NotAfter) {
			return nil, resource.Invalid("CA 证书不在有效期内")
		}
		if ca.NotAfter.Before(validUntil) {
			validUntil = ca.NotAfter
		}
		count++
		data = []byte(strings.TrimSpace(string(rest)))
	}
	if count == 0 {
		return nil, resource.Invalid("CA 证书不能为空")
	}
	// SDK 仅接收文件路径，构造完成后证书已加载到内存。
	dir, err := os.MkdirTemp("", "monkeyai-wallet-")
	if err != nil {
		return nil, errors.New("创建钱包证书临时目录失败")
	}
	defer os.RemoveAll(dir)
	for name, content := range map[string]string{"app.crt": cfg.Certificate, "app.key": cfg.PrivateKey, "ca.crt": cfg.CACertificate} {
		if err = os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			return nil, errors.New("写入钱包证书临时文件失败")
		}
	}
	openURL, walletURL := walletEndpoints(cfg.BaseURL)
	client, err := opensdk.NewOpenClientWithConfig(opensdk.OpenClientConfig{
		Env: opensdk.OpenClientEnvProd, AppID: cfg.AppID, OpenAPIURL: openURL, WalletURL: walletURL,
		PrivateKeyPath: filepath.Join(dir, "app.key"), CertPath: filepath.Join(dir, "app.crt"), CAFile: filepath.Join(dir, "ca.crt"),
	})
	if err != nil {
		return nil, resource.Invalid("初始化百智云客户端失败，请检查证书配置")
	}
	return &Wallet{Client: client, BaseURL: cfg.BaseURL, AppID: cfg.AppID, CertificateExpiresAt: cert.NotAfter, validUntil: validUntil, config: cfg, source: "admin"}, nil
}

func (s *Service) walletConfig(ctx context.Context, q resource.Queryer) (*WalletConfig, error) {
	record, err := sqlc.New(q).GetPolicy(ctx)
	if err != nil {
		return nil, err
	}
	var value struct {
		Wallet *WalletConfig `json:"wallet"`
	}
	if err = json.Unmarshal(record.Value, &value); err != nil {
		return nil, errors.New("读取百智云配置失败")
	}
	return value.Wallet, nil
}

func (s *Service) wallet(ctx context.Context, q resource.Queryer) (*Wallet, error) {
	cfg, err := s.walletConfig(ctx, q)
	if err != nil {
		return nil, err
	}
	if cfg == nil {
		return s.fallback, nil
	}
	s.walletMu.Lock()
	defer s.walletMu.Unlock()
	if s.cachedWallet == nil || s.cachedWallet.config != *cfg {
		wallet, err := newWallet(*cfg)
		if err != nil {
			wallet = &Wallet{BaseURL: cfg.BaseURL, AppID: cfg.AppID, config: *cfg, source: "admin", error: err.Error()}
		}
		s.cachedWallet = wallet
	}
	return s.cachedWallet, nil
}

func (w *Wallet) ready() bool {
	return w != nil && w.Client != nil && (w.validUntil.IsZero() || time.Now().Before(w.validUntil))
}

func (w *Wallet) info() WalletInfo {
	if w == nil {
		return WalletInfo{}
	}
	info := WalletInfo{Configured: w.ready(), BaseURL: w.BaseURL, AppID: w.AppID, Source: w.source, Error: w.error,
		CredentialsConfigured: w.config.Certificate != "" && w.config.PrivateKey != "" && w.config.CACertificate != ""}
	if !w.CertificateExpiresAt.IsZero() {
		info.CertificateExpiresAt = &w.CertificateExpiresAt
	}
	if w.Client != nil && !w.ready() {
		info.Error = "客户端证书或 CA 证书已过期，请更新证书"
	}
	return info
}

func (s *Service) saveWallet(ctx context.Context, q resource.Queryer, in map[string]json.RawMessage) (WalletInfo, WalletInfo, error) {
	previous, err := s.wallet(ctx, q)
	if err != nil {
		return WalletInfo{}, WalletInfo{}, err
	}
	var next WalletConfig
	if previous != nil {
		next = previous.config
	}
	next.BaseURL, next.AppID = "", 0
	if json.Unmarshal(in["base_url"], &next.BaseURL) != nil || json.Unmarshal(in["app_id"], &next.AppID) != nil {
		return WalletInfo{}, WalletInfo{}, resource.Invalid("请提供百智云服务 URL 和应用 ID")
	}
	for name, target := range map[string]*string{"certificate": &next.Certificate, "private_key": &next.PrivateKey, "ca_certificate": &next.CACertificate} {
		if raw, ok := in[name]; ok {
			var value string
			if string(raw) == "null" || json.Unmarshal(raw, &value) != nil {
				return WalletInfo{}, WalletInfo{}, resource.Invalid("证书和私钥必须为 PEM 文本")
			}
			if value = strings.TrimSpace(value); value != "" {
				*target = value
			}
		}
	}
	wallet, err := newWallet(next)
	if err != nil {
		return WalletInfo{}, WalletInfo{}, err
	}
	next = wallet.config
	pending, err := sqlc.New(q).HasOtherWalletTransactions(ctx, sqlc.HasOtherWalletTransactionsParams{BaseUrl: next.BaseURL, AppID: int32(next.AppID)})
	if err != nil {
		return WalletInfo{}, WalletInfo{}, err
	}
	if pending {
		return WalletInfo{}, WalletInfo{}, fail(409, "wallet_transactions_pending", "存在未完成的远程交易，请处理后再切换服务 URL 或应用 ID；同一应用可以更新证书")
	}
	raw, _ := json.Marshal(next)
	_, err = sqlc.New(q).SaveWalletConfig(ctx, raw)
	return previous.info(), wallet.info(), err
}

func normalizeWalletURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return "", errors.New("请输入完整的 HTTPS 服务地址，不含用户名或密码")
	}
	if (u.Path != "" && u.Path != "/") || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || strings.Contains(raw, "#") {
		return "", errors.New("仅填写服务根地址，不含路径、查询参数或片段")
	}
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", errors.New("端口必须在 1 到 65535 之间")
		}
		port = strconv.Itoa(n)
	}
	host := strings.ToLower(u.Hostname())
	if port != "" && port != "443" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return "https://" + host, nil
}

func walletEndpoints(baseURL string) (string, string) {
	switch baseURL {
	case "https://baizhi.cloud":
		return opensdk.ProdOpenAPIURL, opensdk.ProdWalletURL
	case "https://baizhiyun.vip":
		return opensdk.DevOpenAPIURL, opensdk.DevWalletURL
	default:
		return baseURL, baseURL
	}
}
