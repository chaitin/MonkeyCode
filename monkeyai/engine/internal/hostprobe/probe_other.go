//go:build !linux || (!amd64 && !arm64)

package hostprobe

import "context"

func (local) Probe(_ context.Context, driver Driver, _ string) Candidate {
	c := Candidate{Driver: driver}
	c.add("platform", Unsupported, "执行引擎需要受支持架构的 Linux 平台")
	return c
}
