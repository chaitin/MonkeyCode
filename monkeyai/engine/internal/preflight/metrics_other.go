//go:build !linux

package preflight

func systemInfo(string) (*System, cpuTimes) { return nil, cpuTimes{} }
