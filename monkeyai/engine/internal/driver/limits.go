package driver

import (
	"errors"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

func taskLimit(s *specs.Spec) error {
	if s == nil || s.Process == nil || s.Process.User.UID != 1000 || !s.Process.NoNewPrivileges || s.Process.Capabilities == nil || len(s.Process.Capabilities.Permitted) > 0 || len(s.Process.Capabilities.Effective) > 0 {
		return errors.New("沙箱执行身份不满足任务限制要求")
	}
	count := 0
	for _, r := range s.Process.Rlimits {
		if r.Type == "RLIMIT_NPROC" {
			count++
			if r.Soft != sandboxTasks || r.Hard != sandboxTasks {
				return errors.New("沙箱任务上限不一致")
			}
		}
	}
	if count != 1 {
		return errors.New("沙箱缺少有效任务上限，需停止后创建新实例")
	}
	return nil
}
