package lifecycle

import "time"

type Usage struct {
	At          time.Time `json:"at"`
	CPUCores    *float64  `json:"cpu_cores,omitempty"`
	MemoryBytes *uint64   `json:"memory_bytes,omitempty"`
}
