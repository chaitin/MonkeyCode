package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/smtp"
	"strings"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/templates"
)

type EmailClient struct {
	*Smtp
}

func NewSMTPClient(i *do.Injector) (domain.EmailSender, error) {
	return &EmailClient{
		Smtp: NewSmtp(do.MustInvoke[*config.Config](i)),
	}, nil
}

func (c *EmailClient) SendResetPasswordEmail(ctx context.Context, to, username, resetURL string) error {
	tmpl, err := template.New("reset").Parse(string(templates.ResetPassword))
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, map[string]string{
		"user":      username,
		"reset_url": resetURL,
	}); err != nil {
		return err
	}
	return c.Send("Reset Your Password", to, buf.String())
}

type Smtp struct {
	cfg *config.Config
}

func NewSmtp(cfg *config.Config) *Smtp {
	return &Smtp{
		cfg: cfg,
	}
}

func (s *Smtp) Send(subject, receiver, content string) error {
	addr := net.JoinHostPort(s.cfg.SMTP.Host, s.cfg.SMTP.Port)
	c, err := dial(addr, s.cfg.SMTP.TLS)
	if err != nil {
		return err
	}
	defer c.Close()

	header := make(map[string]string)
	header["From"] = "MonkeyCode-AI" + "<" + s.cfg.SMTP.From + ">"
	header["To"] = receiver
	header["Subject"] = subject
	header["Content-Type"] = "text/html; charset=UTF-8"

	var message strings.Builder
	for k, v := range header {
		fmt.Fprintf(&message, "%s: %s\r\n", k, v)
	}
	message.WriteString("\r\n" + content)

	auth := smtp.PlainAuth(
		"",
		s.cfg.SMTP.From,
		s.cfg.SMTP.Password,
		s.cfg.SMTP.Host,
	)

	if ok, _ := c.Extension("AUTH"); ok {
		if err = c.Auth(auth); err != nil {
			log.Println("Error during AUTH", err)
			return err
		}
	}

	if err = c.Mail(s.cfg.SMTP.From); err != nil {
		return err
	}

	if err = c.Rcpt(receiver); err != nil {
		return err
	}

	w, err := c.Data()
	if err != nil {
		return err
	}

	_, err = w.Write([]byte(message.String()))
	if err != nil {
		return err
	}

	err = w.Close()
	if err != nil {
		return err
	}

	return c.Quit()
}

// return a smtp client
func dial(addr string, useTLS bool) (*smtp.Client, error) {
	host, _, _ := net.SplitHostPort(addr)
	if useTLS {
		conn, err := tls.Dial("tcp", addr, nil)
		if err != nil {
			log.Println("Dialing Error:", err)
			return nil, err
		}
		return smtp.NewClient(conn, host)
	}
	c, err := smtp.Dial(addr)
	if err != nil {
		log.Println("Dialing Error:", err)
		return nil, err
	}
	return c, nil
}
