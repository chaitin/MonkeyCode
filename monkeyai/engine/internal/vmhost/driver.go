package vmhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

func fingerprint(s lifecycle.Spec) string {
	s.Generation = 0
	s.DesiredState = ""
	s.RuntimePackage = nil
	raw, _ := json.Marshal(s)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
func validate(s lifecycle.Spec, n firecracker.State, ref string) error {
	if n.ID != storage.Key(s.EnvironmentID) || ref != "" && ref != n.ID || n.Spec.Fingerprint != fingerprint(s) || n.Spec.Disk.InstanceID != s.InstanceID || n.Generation > s.Generation {
		return errors.New("虚拟机冻结规格、代次或实例归属不匹配")
	}
	return nil
}
func (d *Driver) Prepare(ctx context.Context, s lifecycle.Spec) (result error) {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return err
	}
	existing, err := manager.Inspect(ctx, s.EnvironmentID)
	if err == nil {
		if err := validate(s, existing, ""); err != nil {
			return err
		}
		pool, err := d.pool()
		if err != nil {
			return err
		}
		return pool.Commit(s.EnvironmentID)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	unlockCache, err := control.Lock(filepath.Join(d.state, "cache.lock"))
	if err != nil {
		return err
	}
	defer unlockCache()
	dir, r, err := d.components(s)
	if err != nil {
		return err
	}
	pool, err := d.pool()
	if err != nil {
		return err
	}
	// 转换预留之外，持久盘克隆还需覆盖镜像内容和文件系统元数据。
	physical := min(s.VirtualMachine.DiskBytes, d.config.ConversionBytes) + s.VirtualMachine.DiskBytes/16 + d.config.ConversionBytes*3
	if err := pool.ReserveFiles(ctx, s.EnvironmentID, s.VirtualMachine.DiskBytes, physical, d.config.ConversionFiles+2048); err != nil {
		return err
	}
	defer func() {
		if result == nil || errors.Is(result, vmimage.ErrConversionCleanup) {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		result = errors.Join(result, d.releasePreparation(cleanup, s))
	}()
	fetchRoot := filepath.Join(d.data, "fetches")
	if err := storage.PrivateDir(fetchRoot); err != nil {
		return err
	}
	work, err := os.MkdirTemp(fetchRoot, ".prepare-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	registry, err := vmimage.NewRegistry(d.client, d.hostID)
	if err != nil {
		return err
	}
	image, err := registry.Pull(ctx, s.DigestReference(), s.VirtualMachine.Architecture, d.config.ConversionBytes, filepath.Join(work, "oci"))
	if err != nil {
		return err
	}
	tool := func(name string) vmimage.Tool {
		return vmimage.Tool{Path: filepath.Join(dir, name), Digest: "sha256:" + r.Files[name]}
	}
	converter := vmimage.Converter{Unpack: tool("umoci"), Mkfs: tool("mke2fs"), Limits: vmimage.Limits{Bytes: d.config.ConversionBytes, Files: d.config.ConversionFiles, Timeout: 15 * time.Minute}}
	for _, asset := range []struct {
		name, target string
		mode         uint32
	}{
		{"monkeyai-guest", "opt/monkeyai/monkeyai-guest", 0755},
		{"guest-bootstrap", "opt/monkeyai/guest-bootstrap", 0755},
		{"monkeyai-guest.service", "etc/systemd/system/monkeyai-guest.service", 0644},
	} {
		converter.Assets = append(converter.Assets, vmimage.Asset{Target: asset.target, Digest: "sha256:" + r.Files[asset.name], Mode: asset.mode, Source: filepath.Join(dir, asset.name)})
	}
	generated := map[string]string{"etc/systemd/system/monkeyai-maintenance.target": "[Unit]\nDescription=MonkeyAI runtime maintenance\nRequires=basic.target monkeyai-guest.service\nAfter=basic.target monkeyai-guest.service\nAllowIsolate=yes\n", "etc/systemd/system/multi-user.target.d/monkeyai.conf": "[Unit]\nWants=monkeyai-guest.service\nAfter=monkeyai-guest.service\n", "etc/resolv.conf": ""}
	for _, dns := range d.config.DNS {
		generated["etc/resolv.conf"] += "nameserver " + dns + "\n"
	}
	index := 0
	for target, text := range generated {
		source := filepath.Join(work, "asset-"+string(rune('a'+index)))
		index++
		if err := os.WriteFile(source, []byte(text), 0600); err != nil {
			return err
		}
		hash := sha256.Sum256([]byte(text))
		converter.Assets = append(converter.Assets, vmimage.Asset{Target: target, Digest: "sha256:" + hex.EncodeToString(hash[:]), Mode: 0644, Source: source})
	}
	implementation, err := vmimage.CurrentTool(ctx)
	if err != nil {
		return err
	}
	converter.ImplementationDigest = implementation.Digest
	cd, bd, err := converter.Identity()
	if err != nil {
		return err
	}
	identity := vmimage.Identity{Architecture: s.VirtualMachine.Architecture, ImageDigest: image.Manifest.Digest, ConverterDigest: cd, KernelDigest: "sha256:" + r.Files["kernel"], BootstrapDigest: bd, DiskBytes: s.VirtualMachine.DiskBytes}
	cache, err := vmimage.New(filepath.Join(d.data, "templates"))
	if err != nil {
		return err
	}
	template, err := cache.Ensure(ctx, identity, converter.BuildIsolated(filepath.Join(work, "oci"), implementation))
	if err != nil {
		return err
	}
	key, err := identity.Key()
	if err != nil {
		return err
	}
	if _, err := manager.Create(ctx, d.nativeSpec(s, key), template.Path); err != nil {
		return err
	}
	return pool.Commit(s.EnvironmentID)
}
func (d *Driver) Create(ctx context.Context, s lifecycle.Spec) (string, error) {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return "", err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return "", err
	}
	if err := validate(s, actual, ""); err != nil {
		return "", err
	}
	return actual.ID, nil
}
func (d *Driver) Start(ctx context.Context, s lifecycle.Spec, ref string) error {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return err
	}
	if err := validate(s, actual, ref); err != nil {
		return err
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
		return errors.New("存储池压力尚未恢复，禁止启动虚拟机")
	}
	if actual.ProtectionGeneration != 0 {
		if err := manager.ClearProtection(ctx, s.EnvironmentID, s.Generation, func(context.Context) error {
			capacity, err := vmdisk.ReadCapacity(d.data)
			if err != nil {
				return err
			}
			return d.config.Policy.Admit(capacity, vmdisk.PressureCritical, 0, 1)
		}); err != nil {
			return err
		}
	}
	_, err = manager.Start(ctx, s.EnvironmentID, s.Generation)
	return err
}
func (d *Driver) Stop(ctx context.Context, s lifecycle.Spec, ref string) error {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return err
	}
	actual, inspectErr := manager.Inspect(ctx, s.EnvironmentID)
	if inspectErr != nil && actual.ID == "" {
		return inspectErr
	}
	if err := validate(s, actual, ref); err != nil {
		return err
	}
	_, err = manager.Stop(ctx, s.EnvironmentID, s.Generation)
	return err
}
func (d *Driver) FinalizeStop(ctx context.Context, s lifecycle.Spec, ref string) error {
	return d.Stop(ctx, s, ref)
}
func (d *Driver) Inspect(ctx context.Context, s lifecycle.Spec, ref string) (lifecycle.Instance, error) {
	_, manager, host, err := d.stores(s)
	if err != nil {
		return lifecycle.Instance{}, err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	protection := actual.Protection
	if actual.ProtectionGeneration == 0 {
		protection = nil
	}
	if errors.Is(err, os.ErrNotExist) && ref == "" {
		return lifecycle.Instance{Phase: lifecycle.InstanceAbsent}, nil
	}
	if err != nil {
		if actual.ID != "" && protection != nil {
			if err := validate(s, actual, ref); err != nil {
				return lifecycle.Instance{}, err
			}
			return lifecycle.Instance{Ref: actual.ID, Phase: lifecycle.InstanceProtected, Protection: protection}, nil
		}
		if actual.ID == "" || s.DesiredState == lifecycle.DesiredRunning {
			return lifecycle.Instance{}, err
		}
		active, processErr := host.ActiveProcess(ctx, actual.ID)
		if processErr != nil {
			return lifecycle.Instance{}, processErr
		}
		if active {
			if err := validate(s, actual, ref); err != nil {
				return lifecycle.Instance{}, err
			}
			return lifecycle.Instance{Ref: actual.ID, Phase: lifecycle.InstanceRunning, Protection: protection}, nil
		}
	}
	if err := validate(s, actual, ref); err != nil {
		return lifecycle.Instance{}, err
	}
	phase := lifecycle.InstanceStopped
	switch actual.Phase {
	case "created":
		phase = lifecycle.InstanceCreated
	case "running":
		phase = lifecycle.InstanceRunning
	case "paused":
		phase = lifecycle.InstancePaused
	case "retained", "destroyed":
		return lifecycle.Instance{Phase: lifecycle.InstanceAbsent, Protection: protection}, nil
	case "starting", "failed", "stopping":
		active, err := host.ActiveProcess(ctx, actual.ID)
		if err != nil {
			return lifecycle.Instance{}, err
		}
		if active {
			phase = lifecycle.InstanceRunning
		}
	}
	if phase == lifecycle.InstanceRunning && s.DesiredState == lifecycle.DesiredRunning && actual.Generation != s.Generation {
		return lifecycle.Instance{}, errors.New("运行中的虚拟机来自另一控制代次")
	}
	return lifecycle.Instance{Ref: actual.ID, Phase: phase, Protection: protection}, nil
}
func (d *Driver) Remove(ctx context.Context, s lifecycle.Spec, ref string) error {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return err
	}
	if err := validate(s, actual, ref); err != nil {
		return err
	}
	_, err = manager.Retain(ctx, s.EnvironmentID, s.Generation)
	return err
}
func (d *Driver) Status(ctx context.Context, s lifecycle.Spec) (standalone.Status, error) {
	c, err := d.guest(ctx, s)
	if err != nil {
		return standalone.Status{}, err
	}
	defer c.Close()
	if err := awaitGuest(ctx, c); err != nil {
		return standalone.Status{}, err
	}
	if s.RuntimePackage != nil {
		version, err := c.Version(ctx)
		if err != nil {
			return standalone.Status{}, err
		}
		if version != s.RuntimePackage.Version {
			stage, err := d.fetchRuntime(ctx, *s.RuntimePackage)
			if err != nil {
				return standalone.Status{}, err
			}
			defer os.RemoveAll(stage)
			if err := c.Install(ctx, *s.RuntimePackage, func(name string) (io.ReadCloser, error) { return os.Open(filepath.Join(stage, name)) }); err != nil {
				return standalone.Status{}, err
			}
			if version, err := c.Version(ctx); err != nil || version != s.RuntimePackage.Version {
				return standalone.Status{}, errors.New("首次启动runtime版本不一致")
			}
		}
	}
	return c.Status(ctx, s)
}
func (d *Driver) Login(ctx context.Context, s lifecycle.Spec, approve func(string) error) error {
	c, err := d.guest(ctx, s)
	if err != nil {
		return err
	}
	defer c.Close()
	return c.Login(ctx, s, approve)
}
func (d *Driver) Serve(ctx context.Context, s lifecycle.Spec, observe bool) error {
	c, err := d.guest(ctx, s)
	if err != nil {
		return err
	}
	defer c.Close()
	return c.Serve(ctx, s, observe)
}

var _ lifecycle.Driver = (*Driver)(nil)
var _ standalone.Runner = (*Driver)(nil)
