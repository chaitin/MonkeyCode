package vmdisk

import (
	"errors"
	"fmt"
)

type Pressure string

const (
	PressureNormal   Pressure = "normal"
	PressureWarning  Pressure = "warning"
	PressureCritical Pressure = "critical"
)

type Capacity struct {
	TotalBytes     int64
	AvailableBytes int64
	TotalInodes    int64
	FreeInodes     int64
}

type PressurePolicy struct {
	WarningBytes   int64
	CriticalBytes  int64
	RecoveryBytes  int64
	WarningInodes  int64
	CriticalInodes int64
	RecoveryInodes int64
}

func (p PressurePolicy) Validate() error {
	if p.CriticalBytes < 0 || p.WarningBytes <= p.CriticalBytes || p.RecoveryBytes <= p.WarningBytes ||
		p.CriticalInodes < 0 || p.WarningInodes <= p.CriticalInodes || p.RecoveryInodes <= p.WarningInodes {
		return errors.New("capacity thresholds must increase from critical to warning to recovery")
	}
	return nil
}

func (c Capacity) validate() error {
	if c.TotalBytes <= 0 || c.AvailableBytes < 0 || c.AvailableBytes > c.TotalBytes ||
		c.TotalInodes <= 0 || c.FreeInodes < 0 || c.FreeInodes > c.TotalInodes {
		return errors.New("invalid filesystem capacity")
	}
	return nil
}

// 危险态采用滞回阈值，解除告警不代表允许自动恢复已暂停的环境。
func (p PressurePolicy) Evaluate(c Capacity, previous Pressure) (Pressure, error) {
	if err := p.Validate(); err != nil {
		return "", err
	}
	if err := c.validate(); err != nil {
		return "", err
	}
	if previous != "" && previous != PressureNormal && previous != PressureWarning && previous != PressureCritical {
		return "", errors.New("unknown previous pressure state")
	}
	if c.AvailableBytes <= p.CriticalBytes || c.FreeInodes <= p.CriticalInodes {
		return PressureCritical, nil
	}
	if previous == PressureCritical && (c.AvailableBytes < p.RecoveryBytes || c.FreeInodes < p.RecoveryInodes) {
		return PressureCritical, nil
	}
	if c.AvailableBytes <= p.WarningBytes || c.FreeInodes <= p.WarningInodes {
		return PressureWarning, nil
	}
	if previous == PressureWarning && (c.AvailableBytes < p.RecoveryBytes || c.FreeInodes < p.RecoveryInodes) {
		return PressureWarning, nil
	}
	return PressureNormal, nil
}

// reserved 为其他在途操作尚未落盘的预算，不与磁盘逻辑容量求和。
func (p PressurePolicy) Admit(c Capacity, state Pressure, reserved, requested int64) error {
	pressure, err := p.Evaluate(c, state)
	if err != nil {
		return err
	}
	if reserved < 0 || requested <= 0 {
		return errors.New("invalid physical capacity reservation")
	}
	if pressure != PressureNormal {
		return fmt.Errorf("filesystem pressure %s blocks new disk allocations", pressure)
	}
	// 分步相减避免不可信配置或请求导致整数溢出。
	remaining := c.AvailableBytes - p.WarningBytes
	if reserved > remaining || requested > remaining-reserved {
		return errors.New("insufficient unreserved physical capacity")
	}
	return nil
}
