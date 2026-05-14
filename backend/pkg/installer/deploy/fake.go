package deploy

import "context"

type FakeRunner struct {
	Calls   []string
	OnRun   func(name string, args ...string) RunResult
	OnShell func(script string) RunResult
}

func (f *FakeRunner) Run(ctx context.Context, name string, args ...string) RunResult {
	full := append([]string{name}, args...)
	f.Calls = append(f.Calls, joinArgs(full))
	if f.OnRun != nil {
		return f.OnRun(name, args...)
	}
	return RunResult{}
}

func (f *FakeRunner) RunShell(ctx context.Context, script string) RunResult {
	f.Calls = append(f.Calls, "sh: "+script)
	if f.OnShell != nil {
		return f.OnShell(script)
	}
	return RunResult{}
}

func joinArgs(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " "
		}
		out += p
	}
	return out
}
