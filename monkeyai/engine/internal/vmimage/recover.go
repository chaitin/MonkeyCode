package vmimage

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

var conversionUnit = regexp.MustCompile(`^ma-cvt-[a-f0-9]{24}\.service$`)

type conversionJob struct {
	Unit         string `json:"unit"`
	IdentityUnit string `json:"identity_unit,omitempty"`
}

func saveConversionJob(stage, unit string) error {
	if !conversionUnit.MatchString(unit) {
		return errors.New("转换服务标识无效")
	}
	raw, _ := json.Marshal(conversionJob{Unit: unit, IdentityUnit: identityUnit(unit)})
	return control.Write(filepath.Join(stage, "job.json"), raw, 0600)
}
func recoverConversion(ctx context.Context, stage string) error {
	info, err := os.Lstat(stage)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("中断转换暂存目录类型或权限无效")
	}
	path := filepath.Join(stage, "job.json")
	info, err = os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.RemoveAll(stage)
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 256 {
		return errors.New("中断转换服务登记无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var job conversionJob
	if json.Unmarshal(raw, &job) != nil || !conversionUnit.MatchString(job.Unit) || job.IdentityUnit != "" && job.IdentityUnit != identityUnit(job.Unit) {
		return errors.New("中断转换服务身份无效")
	}
	// systemd拥有完整进程组；只有确认其已退出后才回收非用户数据。
	result, err := exec.CommandContext(ctx, "systemctl", "show", job.Unit, "--property=LoadState,ActiveState,MainPID,ControlGroup").Output()
	if err != nil {
		return errors.Join(ErrConversionCleanup, err)
	}
	if err := verifyConversionState(job.Unit, string(result)); err != nil {
		return err
	}
	if job.IdentityUnit != "" {
		if err := releaseConversionIdentity(ctx, job.IdentityUnit); err != nil {
			return errors.Join(ErrConversionCleanup, err)
		}
	}
	return os.RemoveAll(stage)
}

func identityUnit(unit string) string {
	return strings.TrimSuffix(unit, ".service") + "-identity.service"
}

func releaseConversionIdentity(ctx context.Context, unit string) error {
	stopErr := exec.CommandContext(ctx, "systemctl", "stop", unit).Run()
	state, err := exec.CommandContext(ctx, "systemctl", "show", unit, "--property=LoadState,ActiveState,MainPID,ControlGroup").Output()
	if err != nil {
		return errors.Join(stopErr, err)
	}
	return verifyConversionState(unit, string(state))
}
func cleanConversionState(stage, unit, raw string) error {
	if err := verifyConversionState(unit, raw); err != nil {
		return err
	}
	return os.RemoveAll(stage)
}
func verifyConversionState(unit, raw string) error {
	props := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			props[key] = value
		}
	}
	if props["MainPID"] != "0" || props["LoadState"] != "not-found" && props["ActiveState"] != "inactive" && props["ActiveState"] != "failed" {
		return ErrConversionCleanup
	}
	group := props["ControlGroup"]
	if group != "" && group != "/system.slice/"+unit {
		return errors.New("中断转换进程组归属不符")
	}
	if group != "" {
		root := "/sys/fs/cgroup" + group
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			if err != nil {
				return err
			}
			if entry.Name() != "cgroup.procs" {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if strings.TrimSpace(string(data)) != "" {
				return ErrConversionCleanup
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
