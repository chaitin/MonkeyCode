package steps

import (
	"errors"
	"fmt"
	"net"
	"net/mail"
	"path/filepath"
	"strconv"
	"strings"
)

func validateAbsPath(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("请输入路径")
	}
	if !filepath.IsAbs(v) {
		return fmt.Errorf("请输入绝对路径")
	}
	return nil
}

func validateAccessHost(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("请输入服务端访问地址")
	}
	if net.ParseIP(v) != nil {
		return nil
	}
	if strings.Contains(v, "://") || strings.ContainsAny(v, "/?#@") || strings.ContainsAny(v, " \t\r\n") {
		return fmt.Errorf("请输入 IP 或域名，不要包含协议、路径或端口")
	}
	if strings.Contains(v, ":") {
		return fmt.Errorf("请输入 IP 或域名，端口请填写到访问端口")
	}
	if isDomain(v) {
		return nil
	}
	return fmt.Errorf("请输入有效 IP 或域名")
}

func validatePort(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("请输入端口")
	}
	p, err := strconv.Atoi(v)
	if err != nil || p < 1 || p > 65535 {
		return fmt.Errorf("请输入 1-65535 之间的端口")
	}
	return nil
}

func validateEmail(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("请输入管理员邮箱")
	}
	addr, err := mail.ParseAddress(v)
	if err != nil || addr.Address != v {
		return fmt.Errorf("请输入有效邮箱地址")
	}
	return nil
}

func required(msg string) Validator {
	err := errors.New(msg)
	return func(v string) error {
		if strings.TrimSpace(v) == "" {
			return err
		}
		return nil
	}
}

func isDomain(v string) bool {
	if len(v) > 253 || strings.HasPrefix(v, ".") || strings.HasSuffix(v, ".") {
		return false
	}
	parts := strings.Split(v, ".")
	if len(parts) < 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || len(part) > 63 || strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") {
			return false
		}
		for _, r := range part {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
				continue
			}
			return false
		}
	}
	return true
}
