package driver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/containerd/cgroups/v3/cgroup2"
	runtimeoptions "github.com/containerd/containerd/api/types/runtimeoptions/v1"
	containerd "github.com/containerd/containerd/v2/client"
	"github.com/containerd/containerd/v2/core/images"
	"github.com/containerd/containerd/v2/core/snapshots"
	"github.com/containerd/containerd/v2/pkg/cio"
	"github.com/containerd/containerd/v2/pkg/namespaces"
	"github.com/containerd/errdefs"
	"github.com/containerd/platforms"
)

const namespace = "monkeyai-environments"
const snapshotter = "overlayfs"
const runtimeName = "io.containerd.runsc.v1"
const ownerLabel = "io.monkeyai.owner"
const fingerprintLabel = "io.monkeyai.spec"

type Volumes interface {
	Ensure(context.Context, lifecycle.Spec) ([]storage.Mount, error)
}
type Driver struct {
	client   *containerd.Client
	volumes  Volumes
	root     string
	networks *network.Manager
}

func New(socket, root string, volumes Volumes) (*Driver, error) {
	if volumes == nil || socket != "/run/monkeyai-engine/containerd.sock" {
		return nil, errors.New("需要专用 containerd 和持久卷管理器")
	}
	if os.Geteuid() != 0 {
		return nil, errors.New("环境操作需要 root")
	}
	if err := storage.PrivateDir(root); err != nil {
		return nil, err
	}
	c, err := containerd.New(socket, containerd.WithTimeout(10*time.Second), containerd.WithDefaultNamespace(namespace), containerd.WithDefaultPlatform(platforms.DefaultStrict()))
	if err != nil {
		return nil, err
	}
	return &Driver{client: c, volumes: volumes, root: root, networks: network.New(network.StatePath)}, nil
}
func (d *Driver) Close() error { return d.client.Close() }
func (d *Driver) context(ctx context.Context) context.Context {
	return namespaces.WithNamespace(ctx, namespace)
}
func fingerprint(s lifecycle.Spec) string {
	s.Generation = 0
	s.DesiredState = ""
	b, _ := json.Marshal(s)
	return storage.Key(string(b))
}
func labels(s lifecycle.Spec) map[string]string {
	return map[string]string{ownerLabel: "engine", fingerprintLabel: fingerprint(s), "io.monkeyai.environment": s.EnvironmentID, "io.monkeyai.instance": s.InstanceID}
}
func owned(got map[string]string, s lifecycle.Spec) bool {
	return got[ownerLabel] == "engine" && got[fingerprintLabel] == fingerprint(s) && got["io.monkeyai.environment"] == s.EnvironmentID && got["io.monkeyai.instance"] == s.InstanceID
}
func (d *Driver) instanceDir(s lifecycle.Spec) string { return filepath.Join(d.root, instanceKey(s)) }
func (d *Driver) load(ctx context.Context, s lifecycle.Spec, ref string) (containerd.Container, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	if ref != "" && ref != instanceKey(s) {
		return nil, errors.New("实例引用不匹配")
	}
	c, err := d.client.LoadContainer(ctx, instanceKey(s))
	if err != nil {
		return nil, err
	}
	info, err := c.Info(ctx)
	if err != nil {
		return nil, err
	}
	if !owned(info.Labels, s) || info.Runtime.Name != runtimeName || info.Image != s.Image || info.Snapshotter != snapshotter || info.SnapshotKey != instanceKey(s) {
		return nil, errors.New("containerd 实例归属或规格不一致")
	}
	return c, nil
}
func (d *Driver) Prepare(ctx context.Context, s lifecycle.Spec) error {
	if err := s.Validate(); err != nil {
		return err
	}
	if _, err := os.Stat("/sys/fs/cgroup/cgroup.controllers"); err != nil {
		return errors.New("需要 cgroup v2")
	}
	ctx, cancel := context.WithTimeout(d.context(ctx), 15*time.Minute)
	defer cancel()
	if _, err := d.volumes.Ensure(ctx, s); err != nil {
		return err
	}
	unlock, err := d.cacheLock()
	if err != nil {
		return err
	}
	defer unlock()
	policy, err := cache.Read(cache.ConfigPath)
	if err != nil {
		return err
	}
	labels := map[string]string{cacheOwner: "1", cacheUsed: time.Now().UTC().Format(time.RFC3339Nano)}
	image, err := d.client.GetImage(ctx, s.Image)
	if err == nil {
		if image.Target().Digest.String() != s.ImageDigest {
			return errors.New("镜像内容摘要不一致")
		}
		if _, err := imageConfig(ctx, d.client, image); err != nil {
			return err
		}
		unpacked, err := image.IsUnpacked(ctx, snapshotter)
		if err != nil {
			return err
		}
		labels = image.Labels()
		if labels[cacheOwner] == "1" {
			labels[cacheUsed] = time.Now().UTC().Format(time.RFC3339Nano)
			if _, err := d.client.ImageService().Update(ctx, images.Image{Name: s.Image, Labels: labels}, "labels."+cacheUsed); err != nil {
				return err
			}
		}
		if unpacked {
			_, err := cache.Reclaim(ctx, imageCache{driver: d, keep: s.Image}, policy, false)
			return err
		}
	} else if !errdefs.IsNotFound(err) {
		return err
	}
	if _, err := cache.Reclaim(ctx, imageCache{driver: d, keep: s.Image}, policy, true); err != nil {
		return err
	}
	ctx, release, err := d.client.WithLease(ctx)
	if err != nil {
		return err
	}
	defer release(context.WithoutCancel(ctx))
	image, err = d.client.Pull(ctx, s.Image, containerd.WithPullLabels(labels), containerd.WithPlatformMatcher(platforms.DefaultStrict()), containerd.WithMaxConcurrentDownloads(2), containerd.WithImageHandler(pullLimit()))
	if err != nil {
		return fmt.Errorf("拉取固定摘要镜像: %w", err)
	}
	if image.Target().Digest.String() != s.ImageDigest {
		return errors.New("镜像内容摘要不一致")
	}
	if _, err := imageConfig(ctx, d.client, image); err != nil {
		return err
	}
	unpacked, err := image.IsUnpacked(ctx, snapshotter)
	if err != nil {
		return err
	}
	if !unpacked {
		if err := checkLayers(ctx, d.client, image); err != nil {
			return err
		}
		if err := image.Unpack(ctx, snapshotter); err != nil {
			return err
		}
	}
	return nil
}
func (d *Driver) Create(ctx context.Context, s lifecycle.Spec) (string, error) {
	ctx = d.context(ctx)
	if c, err := d.load(ctx, s, ""); err == nil {
		return c.ID(), nil
	} else if !errdefs.IsNotFound(err) {
		return "", err
	}
	if _, err := os.Lstat(filepath.Join(d.root, "retired", instanceKey(s))); err == nil {
		return "", errors.New("实例标识已回收，启动需要新的实例标识")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	mounts, err := d.volumes.Ensure(ctx, s)
	if err != nil {
		return "", err
	}
	if err := validateMounts(s, mounts); err != nil {
		return "", err
	}
	image, err := d.client.GetImage(ctx, s.Image)
	if err != nil {
		return "", err
	}
	if image.Target().Digest.String() != s.ImageDigest {
		return "", errors.New("镜像摘要改变")
	}
	cfg, err := imageConfig(ctx, d.client, image)
	if err != nil {
		return "", err
	}
	dir := d.instanceDir(s)
	if err := storage.PrivateDir(dir); err != nil {
		return "", err
	}
	// 先持久化不可变绑定；崩溃后只清理有归属证据的实例资源。
	binding := filepath.Join(dir, "spec.json")
	raw, err := os.ReadFile(binding)
	if err == nil {
		if string(raw) != fingerprint(s) {
			return "", errors.New("实例目录已绑定其他规格")
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if err := control.Write(binding, []byte(fingerprint(s)), 0600); err != nil {
			return "", err
		}
	} else {
		return "", err
	}
	attachment, err := d.networks.Ensure(ctx, s)
	if err != nil {
		return "", err
	}
	if err := d.group(s); err != nil {
		return "", err
	}
	networkMode := "none"
	if s.NetworkPolicy == "public-only" {
		networkMode = "sandbox"
	}
	config := fmt.Sprintf("binary_name = %q\nroot = %q\n[runsc_config]\nnetwork = %q\nplatform = %q\n", "/opt/monkeyai-engine/current/bin/runsc", "/run/monkeyai-engine/runsc", networkMode, "systrap")
	configPath := filepath.Join(dir, "runsc.toml")
	if err := control.Write(configPath, []byte(config), 0600); err != nil {
		return "", err
	}
	ctx, release, err := d.client.WithLease(ctx)
	if err != nil {
		return "", err
	}
	defer release(context.WithoutCancel(ctx))
	key := instanceKey(s)
	service := d.client.SnapshotService(snapshotter)
	info, err := service.Stat(ctx, key)
	if err == nil {
		if !owned(info.Labels, s) || info.Kind != snapshots.KindView {
			return "", errors.New("快照归属不一致")
		}
	} else if errdefs.IsNotFound(err) {
		diffIDs, err := image.RootFS(ctx)
		if err != nil {
			return "", err
		}
		parent := chainID(diffIDs)
		if _, err := service.View(ctx, key, parent, snapshots.WithLabels(labels(s))); err != nil {
			return "", err
		}
	} else {
		return "", err
	}
	c, err := d.client.NewContainer(ctx, key, containerd.WithImage(image), containerd.WithSnapshotter(snapshotter), containerd.WithSnapshot(key), containerd.WithContainerLabels(labels(s)), containerd.WithRuntime(runtimeName, &runtimeoptions.Options{TypeUrl: "io.containerd.runsc.v1.options", ConfigPath: configPath}), containerd.WithSpec(withNetwork(buildSpec(s, cfg, mounts), attachment)))
	if err != nil {
		return "", err
	}
	return c.ID(), nil
}
func (d *Driver) group(s lifecycle.Spec) error {
	r := s.Resource
	zero := int64(0)
	group := "/monkeyai/" + instanceKey(s)
	_, err := cgroup2.NewManager("/sys/fs/cgroup", group, &cgroup2.Resources{CPU: &cgroup2.CPU{Max: cgroup2.CPUMax(fmt.Sprintf("%d 100000", r.CPUMillis*100))}, Memory: &cgroup2.Memory{Max: &r.MemoryBytes, Swap: &zero}, Pids: &cgroup2.Pids{Max: r.HostTasks}})
	if err != nil {
		return err
	}
	if _, err := cgroup2.NewManager("/sys/fs/cgroup", group+"/shim", &cgroup2.Resources{}); err != nil {
		return err
	}
	for name, want := range map[string]string{"cpu.max": fmt.Sprintf("%d 100000", r.CPUMillis*100), "memory.max": fmt.Sprint(r.MemoryBytes), "memory.swap.max": "0", "pids.max": fmt.Sprint(r.HostTasks)} {
		b, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", group, name))
		if err != nil {
			return err
		}
		if strings.TrimSpace(string(b)) != want {
			return errors.New("cgroup 资源限额读取结果不一致")
		}
	}
	return nil
}
func (d *Driver) Start(ctx context.Context, s lifecycle.Spec, ref string) error {
	ctx = d.context(ctx)
	c, err := d.load(ctx, s, ref)
	if err != nil {
		return err
	}
	oci, err := c.Spec(ctx)
	if err != nil {
		return err
	}
	if err := taskLimit(oci); err != nil {
		return err
	}
	if err := d.networks.Check(ctx, s); err != nil {
		return err
	}
	task, err := c.Task(ctx, nil)
	if errdefs.IsNotFound(err) {
		task, err = c.NewTask(ctx, cio.NullIO)
	}
	if err != nil {
		return err
	}
	status, err := task.Status(ctx)
	if err != nil {
		return err
	}
	if status.Status == containerd.Running {
		return nil
	}
	if status.Status != containerd.Created {
		return errors.New("已退出实例不能自动再次执行")
	}
	if err := d.containProcesses(s, task.Pid()); err != nil {
		return err
	}
	return task.Start(ctx)
}
func (d *Driver) Stop(ctx context.Context, s lifecycle.Spec, ref string) error {
	ctx = d.context(ctx)
	c, err := d.load(ctx, s, ref)
	if errdefs.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	task, err := c.Task(ctx, nil)
	if errdefs.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	status, err := task.Status(ctx)
	if err != nil {
		return err
	}
	if status.Status == containerd.Stopped || status.Status == containerd.Created {
		return nil
	}
	if status.Status == containerd.Paused {
		if err := task.Resume(ctx); err != nil {
			return err
		}
	}
	waitCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	exit, err := task.Wait(waitCtx)
	if err != nil {
		return err
	}
	if err := task.Kill(ctx, syscall.SIGTERM, containerd.WithKillAll); err != nil && !errdefs.IsNotFound(err) {
		return err
	}
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-exit:
		return nil
	case <-timer.C:
	}
	if err := task.Kill(ctx, syscall.SIGKILL, containerd.WithKillAll); err != nil && !errdefs.IsNotFound(err) {
		return err
	}
	timer.Reset(10 * time.Second)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-exit:
		return nil
	case <-timer.C:
		return errors.New("强制停止后未确认实例退出")
	}
}
func (d *Driver) Inspect(ctx context.Context, s lifecycle.Spec, ref string) (lifecycle.Instance, error) {
	ctx = d.context(ctx)
	c, err := d.load(ctx, s, ref)
	if errdefs.IsNotFound(err) {
		raw, e := os.ReadFile(filepath.Join(d.instanceDir(s), "spec.json"))
		if e == nil {
			if string(raw) != fingerprint(s) {
				return lifecycle.Instance{}, errors.New("实例目录归属不一致")
			}
			return lifecycle.Instance{Ref: instanceKey(s), Phase: lifecycle.InstanceStopped}, nil
		}
		if !errors.Is(e, os.ErrNotExist) {
			return lifecycle.Instance{}, e
		}
		if _, e := os.Lstat(d.instanceDir(s)); e == nil {
			retired, e := os.ReadFile(filepath.Join(d.root, "retired", instanceKey(s)))
			if e != nil || string(retired) != fingerprint(s) {
				return lifecycle.Instance{}, errors.New("实例控制目录缺少归属记录")
			}
			return lifecycle.Instance{Ref: instanceKey(s), Phase: lifecycle.InstanceStopped}, nil
		} else if !errors.Is(e, os.ErrNotExist) {
			return lifecycle.Instance{}, e
		}
		return lifecycle.Instance{Phase: lifecycle.InstanceAbsent}, nil
	}
	if err != nil {
		return lifecycle.Instance{}, err
	}
	i := lifecycle.Instance{Ref: c.ID(), Phase: lifecycle.InstanceCreated}
	task, err := c.Task(ctx, nil)
	if errdefs.IsNotFound(err) {
		return i, nil
	}
	if err != nil {
		return i, err
	}
	status, err := task.Status(ctx)
	if err != nil {
		return i, err
	}
	switch status.Status {
	case containerd.Running, containerd.Paused, containerd.Pausing:
		i.Phase = lifecycle.InstanceRunning
	case containerd.Created:
	case containerd.Stopped:
		i.Phase = lifecycle.InstanceStopped
	default:
		return i, errors.New("containerd 返回未知任务状态")
	}
	if i.Phase == lifecycle.InstanceRunning && s.DesiredState == lifecycle.DesiredRunning {
		oci, limitErr := c.Spec(ctx)
		if limitErr == nil {
			limitErr = taskLimit(oci)
		}
		if err := errors.Join(limitErr, d.networks.Check(ctx, s)); err != nil {
			// 运行中的隔离条件无法核对时终止实例；停止目标仍可绕过网络检查完成清理。
			killErr := task.Kill(context.WithoutCancel(ctx), syscall.SIGKILL, containerd.WithKillAll)
			return i, errors.Join(err, killErr)
		}
	}
	return i, nil
}
func (d *Driver) Remove(ctx context.Context, s lifecycle.Spec, ref string) error {
	ctx = d.context(ctx)
	c, err := d.load(ctx, s, ref)
	if err != nil && !errdefs.IsNotFound(err) {
		return err
	}
	if err == nil {
		task, e := c.Task(ctx, nil)
		if e == nil {
			status, e := task.Status(ctx)
			if e != nil {
				return e
			}
			if status.Status != containerd.Stopped && status.Status != containerd.Created {
				return errors.New("实例未停止，拒绝回收")
			}
			if _, e := task.Delete(ctx); e != nil && !errdefs.IsNotFound(e) {
				return e
			}
		} else if !errdefs.IsNotFound(e) {
			return e
		}
		if e := c.Delete(ctx); e != nil && !errdefs.IsNotFound(e) {
			return e
		}
	}
	dir := d.instanceDir(s)
	raw, err := os.ReadFile(filepath.Join(dir, "spec.json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			retired, e := os.ReadFile(filepath.Join(d.root, "retired", instanceKey(s)))
			if e == nil && string(retired) == fingerprint(s) {
				if err := os.Remove(dir); err != nil && !errors.Is(err, os.ErrNotExist) {
					return err
				}
				return nil
			}
		}
		return err
	}
	if string(raw) != fingerprint(s) {
		return errors.New("实例目录归属不一致")
	}
	if err := d.networks.Remove(ctx, s); err != nil {
		return err
	}
	service := d.client.SnapshotService(snapshotter)
	info, err := service.Stat(ctx, instanceKey(s))
	if err == nil {
		if !owned(info.Labels, s) {
			return errors.New("拒绝删除未知快照")
		}
		if err := service.Remove(ctx, instanceKey(s)); err != nil {
			return err
		}
	} else if !errdefs.IsNotFound(err) {
		return err
	}
	group := "/monkeyai/" + instanceKey(s)
	manager, err := cgroup2.Load(group)
	if err != nil {
		return err
	}
	if err := manager.Delete(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := storage.PrivateDir(filepath.Join(d.root, "retired")); err != nil {
		return err
	}
	if err := control.Write(filepath.Join(d.root, "retired", instanceKey(s)), []byte(fingerprint(s)), 0600); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() != "spec.json" && entry.Name() != "runsc.toml" {
			return errors.New("实例控制目录含未知内容，拒绝清理")
		}
	}
	// 仅删除固定控制文件，不做递归清理。
	for _, name := range []string{"runsc.toml", "spec.json"} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return os.Remove(dir)
}
