package setting

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/textproto"
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
	defer func() {
		if err := conn.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			slog.WarnContext(ctx, "关闭 SMTP 连接失败", "failure", smtpFailure(err))
		}
	}()
	stop := context.AfterFunc(ctx, func() {
		if err := conn.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			slog.WarnContext(ctx, "取消 SMTP 连接时关闭失败", "failure", smtpFailure(err))
		}
	})
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
	defer func() {
		if err := client.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			slog.WarnContext(ctx, "关闭 SMTP 客户端失败", "failure", smtpFailure(err))
		}
	}()
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
	var message strings.Builder
	message.WriteString(fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n", from, recipient.String(), mime.QEncoding.Encode("UTF-8", subject), time.Now().Format(time.RFC1123Z)))
	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	for len(encoded) > 0 {
		n := min(76, len(encoded))
		message.WriteString(encoded[:n] + "\r\n")
		encoded = encoded[n:]
	}
	if _, err := writer.Write([]byte(message.String())); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	// DATA 已确认接收后，QUIT 失败不应误报发送失败。
	if err := client.Quit(); err != nil && !errors.Is(err, net.ErrClosed) {
		slog.WarnContext(ctx, "SMTP QUIT 失败", "failure", smtpFailure(err))
	}
	return nil
}

func (s *Service) testEmail(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Recipient string `json:"recipient"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil {
		settingError(r.Context(), w, 400, "请求格式无效")
		return
	}
	input.Recipient = strings.TrimSpace(input.Recipient)
	address, err := mail.ParseAddress(input.Recipient)
	if err != nil || address.Address != input.Recipient {
		settingError(r.Context(), w, 400, "收件邮箱无效")
		return
	}
	if err := s.Send(r.Context(), input.Recipient, "MonkeyAI 测试邮件", "这是一封 MonkeyAI 测试邮件，SMTP 发件配置已生效。"); err != nil {
		slog.ErrorContext(r.Context(), "测试邮件发送失败", "failure", smtpFailure(err))
		settingError(r.Context(), w, http.StatusBadGateway, "邮件发送失败，请检查已保存的 SMTP 配置和服务连接")
		return
	}
	settingJSON(r.Context(), w, http.StatusOK, map[string]bool{"sent": true})
}

// SMTP 响应和网络错误可能回显收件人或认证信息，只记录协议状态及错误类别。
func smtpFailure(err error) []any {
	if response, ok := errors.AsType[*textproto.Error](err); ok {
		return []any{"reason", "smtp_rejected", "smtp_status", response.Code}
	}
	if errors.Is(err, ErrNotFound) {
		return []any{"error", ErrNotFound}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return []any{"reason", "timeout"}
	}
	if network, ok := errors.AsType[net.Error](err); ok {
		return []any{"reason", "network_error", "timeout", network.Timeout()}
	}
	return []any{"reason", "email_error", "error_type", fmt.Sprintf("%T", err)}
}
