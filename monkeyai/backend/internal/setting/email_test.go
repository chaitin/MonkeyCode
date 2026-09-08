package setting

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func smtpServer(t *testing.T, reject bool) (emailConfig, <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	messages := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
		reader := textproto.NewReader(bufio.NewReader(conn))
		fmt.Fprint(conn, "220 localhost ESMTP\r\n")
		for {
			line, err := reader.ReadLine()
			if err != nil {
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO"):
				fmt.Fprint(conn, "250 localhost\r\n")
			case strings.HasPrefix(line, "MAIL"):
				fmt.Fprint(conn, "250 OK\r\n")
			case strings.HasPrefix(line, "RCPT"):
				if reject {
					fmt.Fprint(conn, "550 rejected\r\n")
				} else {
					fmt.Fprint(conn, "250 OK\r\n")
				}
			case line == "DATA":
				fmt.Fprint(conn, "354 continue\r\n")
				data, err := reader.ReadDotBytes()
				if err != nil {
					return
				}
				messages <- string(data)
				fmt.Fprint(conn, "250 queued\r\n")
			case line == "QUIT":
				fmt.Fprint(conn, "221 bye\r\n")
				return
			default:
				fmt.Fprint(conn, "502 unsupported\r\n")
			}
		}
	}()
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	n, _ := strconv.Atoi(port)
	return emailConfig{SenderName: "测试发件人", SenderEmail: "sender@example.com", Host: "127.0.0.1", Port: n, Encryption: "none"}, messages
}

func TestSMTPTestEndpoint(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(strconv.FormatBool(reject), func(t *testing.T) {
			cfg, messages := smtpServer(t, reject)
			data, _ := json.Marshal(cfg)
			s := NewService(&memoryStore{records: map[string]Record{"email": {Key: "email", Value: data}}})
			router := chi.NewRouter()
			s.RegisterAdmin(router)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/settings/email/test", strings.NewReader(`{"recipient":"recipient@example.com"}`)))
			if reject {
				if rec.Code != 502 {
					t.Fatalf("SMTP 拒收却返回成功: %d", rec.Code)
				}
				return
			}
			if rec.Code != 200 {
				t.Fatalf("发送失败: %s", rec.Body.String())
			}
			select {
			case message := <-messages:
				if !strings.Contains(message, "To: <recipient@example.com>") || !strings.Contains(message, "Content-Transfer-Encoding: base64") {
					t.Fatalf("邮件格式无效: %s", message)
				}
			default:
				t.Fatal("未发送邮件")
			}
		})
	}
}

func TestSMTPRequiresSTARTTLS(t *testing.T) {
	cfg, _ := smtpServer(t, false)
	cfg.Encryption = "starttls"
	if err := sendEmail(t.Context(), cfg, "user@example.com", "测试", "测试"); err == nil {
		t.Fatal("服务器不支持 STARTTLS 时退回了明文发送")
	}
}

func TestSMTPValidationAndCancellation(t *testing.T) {
	cfg, _ := smtpServer(t, false)
	if err := sendEmail(t.Context(), cfg, "user@example.com\r\nBcc: victim@example.com", "测试", "测试"); err == nil {
		t.Fatal("接受了收件人注入")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := sendEmail(ctx, cfg, "user@example.com", "测试", "测试"); err == nil {
		t.Fatal("忽略了请求取消")
	}
}

func TestDefaultAuthenticationAndEmailSecret(t *testing.T) {
	store := &memoryStore{records: map[string]Record{}}
	s := NewService(store)
	value, err := s.GetValue(t.Context(), "authentication")
	if err != nil || string(value) != "{}" {
		t.Fatalf("新实例默认认证配置不可用: %s %v", value, err)
	}
	cfg := emailConfig{SenderEmail: "sender@example.com", Host: "smtp.example.com", Port: 587, Encryption: "starttls", Password: "secret"}
	data, _ := json.Marshal(cfg)
	if _, err := s.Put(t.Context(), "email", data, 1, "admin"); err != nil {
		t.Fatal(err)
	}
	cfg.Password = ""
	data, _ = json.Marshal(cfg)
	if _, err := s.Put(t.Context(), "email", data, 1, "admin"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(store.records["email"].Value), "secret") {
		t.Fatal("空密码覆盖了原密码")
	}
	for _, value := range []string{`{"password_enabled":"false"}`, `{"email_code_enabled":null}`} {
		if _, err := s.Put(t.Context(), "authentication", json.RawMessage(value), 1, "admin"); err == nil {
			t.Fatal("接受了错误的开关类型")
		}
	}
}
