package setting

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

type emailConfig struct {
	SenderName  string `json:"sender_name"`
	SenderEmail string `json:"sender_email"`
	Host        string `json:"smtp_host"`
	Port        int    `json:"smtp_port"`
	Username    string `json:"smtp_username"`
	Password    string `json:"smtp_password"`
	Encryption  string `json:"smtp_encryption"`
}

func (c emailConfig) validate() error {
	address, err := mail.ParseAddress(c.SenderEmail)
	if err != nil || address.Address != c.SenderEmail || strings.ContainsAny(c.SenderName, "\r\n") {
		return errors.New("发件人邮箱或名称无效")
	}
	if strings.TrimSpace(c.Host) == "" || strings.ContainsAny(c.Host, "\r\n /\\") || c.Port < 1 || c.Port > 65535 {
		return errors.New("SMTP 主机或端口无效")
	}
	if c.Encryption != "starttls" && c.Encryption != "tls" && c.Encryption != "none" {
		return errors.New("SMTP 加密方式无效")
	}
	return nil
}

func (s *Service) Send(ctx context.Context, to, subject, body string) error {
	value, err := s.GetValue(ctx, "email")
	if err != nil {
		return err
	}
	var cfg emailConfig
	if err := json.Unmarshal(value, &cfg); err != nil {
		return err
	}
	return sendEmail(ctx, cfg, to, subject, body)
}

func sendEmail(ctx context.Context, cfg emailConfig, to, subject, body string) error {
	if err := cfg.validate(); err != nil {
		return err
	}
	recipient, err := mail.ParseAddress(to)
	if err != nil || recipient.Address != to {
		return errors.New("收件邮箱无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	address := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return err
	}
	tlsConfig := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	var transport net.Conn = conn
	if cfg.Encryption == "tls" {
		secure := tls.Client(conn, tlsConfig)
		if err := secure.HandshakeContext(ctx); err != nil {
			return err
		}
		transport = secure
	}
	client, err := smtp.NewClient(transport, cfg.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if cfg.Encryption == "starttls" {
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if cfg.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return err
		}
	}
	if err := client.Mail(cfg.SenderEmail); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	from := (&mail.Address{Name: cfg.SenderName, Address: cfg.SenderEmail}).String()
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n", from, recipient.String(), mime.QEncoding.Encode("UTF-8", subject), time.Now().Format(time.RFC1123Z))
	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	for len(encoded) > 0 {
		n := min(76, len(encoded))
		message += encoded[:n] + "\r\n"
		encoded = encoded[n:]
	}
	if _, err := writer.Write([]byte(message)); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	// DATA 已确认接收后，QUIT 失败不应误报发送失败。
	_ = client.Quit()
	return nil
}

func (s *Service) testEmail(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Recipient string `json:"recipient"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil {
		settingError(w, 400, "请求格式无效")
		return
	}
	input.Recipient = strings.TrimSpace(input.Recipient)
	address, err := mail.ParseAddress(input.Recipient)
	if err != nil || address.Address != input.Recipient {
		settingError(w, 400, "收件邮箱无效")
		return
	}
	if err := s.Send(r.Context(), input.Recipient, "MonkeyAI 测试邮件", "这是一封 MonkeyAI 测试邮件，SMTP 发件配置已生效。"); err != nil {
		settingError(w, http.StatusBadGateway, "邮件发送失败，请检查已保存的 SMTP 配置和服务连接")
		return
	}
	settingJSON(w, http.StatusOK, map[string]bool{"sent": true})
}
