package dockerapi

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Docker 和 Registry 的错误正文可能包含认证重定向地址，不原样写入 journal。
func Diagnostic(err error) any {
	if err == nil {
		return nil
	}
	var d *Error
	if errors.As(err, &d) {
		return fmt.Sprintf("Docker API HTTP %d", d.Status)
	}
	if strings.Contains(err.Error(), "Docker 拉取镜像失败：") {
		return "Docker 拉取镜像失败（详见 dockerd 日志）"
	}
	var u *url.Error
	if errors.As(err, &u) {
		return fmt.Sprintf("%s: %v", u.Op, u.Err)
	}
	return err
}
