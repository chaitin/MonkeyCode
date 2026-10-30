package cache

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
)

func Read(path string) (Config, error) {
	c := DefaultConfig()
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 || info.Mode().Perm()&0077 != 0 {
		return c, errors.New("缓存配置必须是私有普通文件")
	}
	if err := owned(info); err != nil {
		return c, err
	}
	f, err := os.Open(path)
	if err != nil {
		return c, err
	}
	defer f.Close()
	after, err := f.Stat()
	if err != nil || !os.SameFile(info, after) {
		return c, errors.New("缓存配置文件发生变化")
	}
	raw, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return c, err
	}
	if len(raw) > 4096 {
		return c, errors.New("缓存配置超过大小限制")
	}
	if len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return c, errors.New("缓存配置必须是 JSON 对象")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, err
	}
	if d.Decode(new(any)) != io.EOF {
		return c, errors.New("缓存配置必须是单个 JSON 对象")
	}
	return c, c.Validate()
}
