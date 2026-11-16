package guest

import (
	"context"
	"errors"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func (c *Client) Version(ctx context.Context) (string, error) {
	version := ""
	err := c.call(ctx, "version", Request{}, func(event Event) error {
		if event.Event != "version" || version != "" || !lifecycle.ValidRuntimeVersion(event.RuntimeVersion) {
			return errors.New("runtime版本响应无效")
		}
		version = event.RuntimeVersion
		return nil
	})
	if err == nil && version == "" {
		err = errors.New("runtime未返回版本")
	}
	return version, err
}
func (p *Process) Version(ctx context.Context) (string, error) {
	command, err := p.command(ctx, []string{"version"})
	if err != nil {
		return "", err
	}
	var result limitedText
	command.Stdout = &result
	if err := command.Run(); err != nil {
		return "", errors.New("runtime版本查询失败")
	}
	version := strings.TrimSpace(string(result.data))
	if result.exceeded || !lifecycle.ValidRuntimeVersion(version) {
		return "", errors.New("runtime返回版本无效")
	}
	return version, nil
}

type limitedText struct {
	data     []byte
	exceeded bool
}

func (t *limitedText) Write(data []byte) (int, error) {
	n := len(data)
	left := 1024 - len(t.data)
	if len(data) > left {
		t.exceeded = true
		data = data[:left]
	}
	t.data = append(t.data, data...)
	return n, nil
}
