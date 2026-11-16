package vmdisk

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

func (p *Pool) pressure(capacity Capacity) (Pressure, error) {
	path := filepath.Join(p.root, "pressure.json")
	previous := PressureNormal
	info, err := os.Lstat(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 32 {
			return "", errors.New("存储保护状态文件无效")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		if json.Unmarshal(raw, &previous) != nil || (previous != PressureNormal && previous != PressureWarning && previous != PressureCritical) {
			return "", errors.New("存储保护状态损坏")
		}
	}
	next, err := p.policy.Evaluate(capacity, previous)
	if err != nil {
		return "", err
	}
	if previous != next {
		raw, _ := json.Marshal(next)
		if err := control.Write(path, raw, 0600); err != nil {
			return next, err
		}
	}
	return next, nil
}
func (p *Pool) Refresh(ctx context.Context) (Pressure, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	unlock, err := p.lock()
	if err != nil {
		return "", err
	}
	defer unlock()
	capacity, err := p.capacity(p.path)
	if err != nil {
		return "", err
	}
	return p.pressure(capacity)
}
