package driver

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/containerd/cgroups/v3/cgroup2"
)

// 固定版本 shim 的 shim_cgroup 配置未实际用于移动进程，必须在用户程序启动前收拢并核对。
func (d *Driver) containProcesses(s lifecycle.Spec, sentry uint32) error {
	raw, err := os.ReadFile(filepath.Join("/run/monkeyai-engine/containerd/io.containerd.runtime.v2.task", namespace, instanceKey(s), "shim.pid"))
	if err != nil {
		return err
	}
	shim, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || shim <= 1 {
		return errors.New("shim PID 无效")
	}
	executable, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", shim))
	if err != nil {
		return err
	}
	expected, err := filepath.EvalSymlinks("/opt/monkeyai-engine/current/bin/containerd-shim-runsc-v1")
	if err != nil {
		return err
	}
	if executable != expected {
		return errors.New("shim 进程与已安装程序不一致")
	}
	group := "/monkeyai/" + instanceKey(s)
	manager, err := cgroup2.Load(group + "/shim")
	if err != nil {
		return err
	}
	if err := manager.AddProc(uint64(shim)); err != nil {
		return err
	}
	// shim 已进入限额组，后续创建的直接子进程自动继承；收拢创建阶段已有的辅助进程。
	for range 3 {
		descendants, err := processTree(shim)
		if err != nil {
			return err
		}
		for _, pid := range descendants {
			path, err := cgroup2.PidGroupPath(pid)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return err
			}
			if path != group && !strings.HasPrefix(path, group+"/") {
				if err := manager.AddProc(uint64(pid)); err != nil && !errors.Is(err, os.ErrNotExist) {
					return err
				}
			}
		}
	}
	for _, pid := range []int{shim, int(sentry)} {
		path, err := cgroup2.PidGroupPath(pid)
		if err != nil {
			return err
		}
		if path != group && !strings.HasPrefix(path, group+"/") {
			return errors.New("shim 或沙箱进程不在实例限额组")
		}
	}
	descendants, err := processTree(shim)
	if err != nil {
		return err
	}
	for _, pid := range descendants {
		path, err := cgroup2.PidGroupPath(pid)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if path != group && !strings.HasPrefix(path, group+"/") {
			return errors.New("沙箱辅助进程仍在实例限额组外")
		}
	}
	return nil
}
func processTree(parent int) ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	children := map[int][]int{}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 1 {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		// comm 可以包含空格与括号，字段从最后一个右括号之后解析。
		end := strings.LastIndexByte(string(raw), ')')
		if end < 0 {
			continue
		}
		fields := strings.Fields(string(raw[end+1:]))
		if len(fields) < 2 {
			continue
		}
		ppid, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}
		children[ppid] = append(children[ppid], pid)
	}
	result := []int{}
	queue := []int{parent}
	seen := map[int]bool{parent: true}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, child := range children[id] {
			if !seen[child] {
				seen[child] = true
				result = append(result, child)
				queue = append(queue, child)
			}
		}
	}
	return result, nil
}
