package vmhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

func (d *Driver) RuntimeVersion(ctx context.Context, s lifecycle.Spec) (string, error) {
	if s.DesiredState == lifecycle.DesiredStopped {
		return d.readRuntimeVersion(s)
	}
	client, err := d.guest(ctx, s)
	if err != nil {
		return "", err
	}
	defer client.Close()
	version, err := client.Version(ctx)
	if err != nil {
		return "", err
	}
	if err := d.saveRuntimeVersion(s, version); err != nil {
		return "", err
	}
	return version, nil
}
func (d *Driver) UpdateRuntime(ctx context.Context, s lifecycle.Spec) (result error) {
	if s.DesiredState != lifecycle.DesiredStopped || s.RuntimePackage == nil || s.RuntimePackage.Validate() != nil {
		return errors.New("虚拟机runtime更新需要已停止目标和固定发行清单")
	}
	_, manager, host, err := d.stores(s)
	if err != nil {
		return err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return err
	}
	if err := validate(s, actual, actual.ID); err != nil {
		return err
	}
	if actual.Phase != "stopped" || actual.Generation != s.Generation || actual.ProtectionGeneration != 0 {
		return errors.New("runtime更新需要已确认停止且未保护锁定的实例")
	}
	pool, err := d.pool()
	if err != nil {
		return err
	}
	pressure, err := pool.Refresh(ctx)
	if err != nil {
		return err
	}
	if pressure != vmdisk.PressureNormal {
		return errors.New("存储压力阻止runtime准备")
	}
	stage, err := d.fetchRuntime(ctx, *s.RuntimePackage)
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	release := *s.RuntimePackage
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		_, stopErr := manager.Stop(cleanup, s.EnvironmentID, s.Generation)
		result = errors.Join(result, stopErr)
	}()
	if _, err := manager.Maintain(ctx, s.EnvironmentID, s.Generation); err != nil {
		return err
	}
	client, err := host.GuestClient(actual.ID)
	if err != nil {
		return err
	}
	defer client.Close()
	if err := awaitGuest(ctx, client); err != nil {
		return err
	}
	if err := client.Install(ctx, release, func(name string) (io.ReadCloser, error) { return os.Open(filepath.Join(stage, name)) }); err != nil {
		return err
	}
	version, err := client.Version(ctx)
	if err != nil {
		return err
	}
	if version != release.Version {
		return errors.New("虚拟机runtime更新后的版本不匹配")
	}
	// 记录与持久盘一起保存，停止状态下的版本查询不需要挂载用户文件系统。
	return d.saveRuntimeVersion(s, version)
}
func awaitGuest(ctx context.Context, client *guest.Client) error {
	ready, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		// Status在维护启动尚未初始化时可能失败；Version可直接验证服务和原始runtime可执行性。
		if _, err := client.Version(ready); err == nil {
			return nil
		}
		select {
		case <-ready.Done():
			return errors.New("虚拟机管理服务未在启动期限内就绪")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (d *Driver) fetchRuntime(ctx context.Context, release lifecycle.RuntimePackage) (string, error) {
	root := filepath.Join(d.data, "runtime-fetches")
	if err := storage.PrivateDir(root); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(root, ".runtime-")
	if err != nil {
		return "", err
	}
	complete := false
	defer func() {
		if !complete {
			os.RemoveAll(stage)
		}
	}()
	for name, file := range release.Files {
		request, err := http.NewRequestWithContext(ctx, "GET", d.client.URL+"/api/host/v1/runtime-releases/"+release.Version+"/"+release.Architecture+"/"+name, nil)
		if err != nil {
			return "", err
		}
		response, err := d.client.HTTP.Do(request)
		if err != nil {
			return "", err
		}
		if response.StatusCode != 200 || response.ContentLength > file.Size {
			response.Body.Close()
			return "", errors.New("runtime固定发行资源不可用")
		}
		destination, err := os.OpenFile(filepath.Join(stage, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			response.Body.Close()
			return "", err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(destination, hash), io.LimitReader(response.Body, file.Size+1))
		if err := errors.Join(copyErr, response.Body.Close(), destination.Sync(), destination.Close()); err != nil {
			return "", err
		}
		if n != file.Size || hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
			return "", errors.New("runtime下载摘要或长度不一致")
		}
	}

	complete = true
	return stage, nil
}
