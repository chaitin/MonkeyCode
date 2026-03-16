package email

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"net/smtp"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

type SMTPClient struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

func NewSMTPClient(cfg SMTPConfig) domain.EmailSender {
	return &SMTPClient{
		Host:     cfg.Host,
		Port:     cfg.Port,
		Username: cfg.Username,
		Password: cfg.Password,
		From:     cfg.From,
	}
}

const resetPasswordTpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<h2>Password Reset</h2>
<p>Hi {{.Username}},</p>
<p>Click the link below to reset your password:</p>
<p><a href="{{.ResetURL}}">{{.ResetURL}}</a></p>
<p>This link will expire in 30 minutes.</p>
<p>If you did not request this, please ignore this email.</p>
</body>
</html>`

const inviteTpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<h2>Team Invitation</h2>
<p>Hi,</p>
<p>You have been invited to join team <b>{{.TeamName}}</b>.</p>
<p>Click the link below to accept:</p>
<p><a href="{{.InviteURL}}">{{.InviteURL}}</a></p>
</body>
</html>`

const verifyCodeTpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<h2>Verification Code</h2>
<p>Hi {{.Username}},</p>
<p>Your verification code is: <b>{{.Code}}</b></p>
<p>This code will expire in {{.ExpireMinutes}} minutes.</p>
</body>
</html>`

func (c *SMTPClient) send(to, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", c.Host, c.Port)
	auth := smtp.PlainAuth("", c.Username, c.Password, c.Host)

	mime := "MIME-version: 1.0;\nContent-Type: text/html; charset=\"UTF-8\";\n\n"
	msg := fmt.Appendf(nil, "From: %s\r\nTo: %s\r\nSubject: %s\r\n%s\r\n%s",
		c.From, to, subject, mime, body)

	return smtp.SendMail(addr, auth, c.From, []string{to}, msg)
}

func (c *SMTPClient) SendResetPasswordEmail(ctx context.Context, to, username, resetURL string) error {
	tmpl, err := template.New("reset").Parse(resetPasswordTpl)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, map[string]string{
		"Username": username,
		"ResetURL": resetURL,
	}); err != nil {
		return err
	}
	return c.send(to, "Reset Your Password", buf.String())
}

func (c *SMTPClient) SendInviteEmail(to, teamName, inviteURL string) error {
	tmpl, err := template.New("invite").Parse(inviteTpl)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, map[string]string{
		"TeamName":  teamName,
		"InviteURL": inviteURL,
	}); err != nil {
		return err
	}
	return c.send(to, "Team Invitation", buf.String())
}

func (c *SMTPClient) SendVerifyCodeEmail(to, username, code string, expireMinutes int) error {
	tmpl, err := template.New("verify").Parse(verifyCodeTpl)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, map[string]any{
		"Username":      username,
		"Code":          code,
		"ExpireMinutes": expireMinutes,
	}); err != nil {
		return err
	}
	return c.send(to, "Verification Code", buf.String())
}
