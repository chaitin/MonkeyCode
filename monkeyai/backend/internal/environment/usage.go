package environment

import (
	"math"
	"time"
)

type Usage struct {
	At          time.Time `json:"at"`
	CPUCores    *float64  `json:"cpu_cores,omitempty"`
	MemoryBytes *uint64   `json:"memory_bytes,omitempty"`
}

func (u *Usage) valid() bool {
	if u == nil {
		return true
	}
	return !u.At.IsZero() && !u.At.After(time.Now().Add(time.Minute)) &&
		(u.CPUCores != nil || u.MemoryBytes != nil) &&
		(u.CPUCores == nil || (!math.IsNaN(*u.CPUCores) && !math.IsInf(*u.CPUCores, 0) && *u.CPUCores >= 0 && *u.CPUCores <= 1<<20)) &&
		(u.MemoryBytes == nil || *u.MemoryBytes <= math.MaxInt64)
}
