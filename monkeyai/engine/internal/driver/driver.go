package driver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockernet"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

const ownerLabel = dockerapi.Owner
const fingerprintLabel = "io.monkeyai.spec"
const sandboxTasks = 512

type Volumes interface {
	Ensure(context.Context, lifecycle.Spec) ([]storage.Mount, error)
}
type Driver struct {
	client  *dockerapi.Client
	volumes Volumes
	root    string
}

func New(socket, root string, volumes Volumes) (*Driver, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 || socket != dockerapi.Socket || volumes == nil {
		return nil, errors.New("Docker/gVisor 驱动需要 Linux root、本地 Docker 和持久卷管理器")
	}
	if err := storage.PrivateDir(root); err != nil {
		return nil, err
	}
	return &Driver{dockerapi.New(socket), volumes, root}, nil
}
func (d *Driver) Close() error { d.client.Close(); return nil }
func instanceKey(s lifecycle.Spec) string {
	return "mc-" + storage.Key(s.EnvironmentID + "\n" + s.InstanceID)[:48]
}
func containerName(s lifecycle.Spec) string {
	if strings.Contains(s.InstanceID, ":") || len(s.InstanceID) < 2 {
		return instanceKey(s)
	}
	return s.InstanceID
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
	for k, v := range labels(s) {
		if got[k] != v {
			return false
		}
	}
	return true
}
func (d *Driver) instanceDir(s lifecycle.Spec) string { return filepath.Join(d.root, instanceKey(s)) }

type Mount struct {
	Type, Source, Target string
	ReadOnly             bool
	BindOptions          struct{ Propagation string }
}
type Ulimit struct {
	Name       string
	Soft, Hard int64
}
type HostConfig struct {
	Runtime, NetworkMode, PidMode, IpcMode, UTSMode, UsernsMode, CgroupnsMode string
	Privileged, ReadonlyRootfs, PublishAllPorts, AutoRemove                   bool
	CapAdd, CapDrop, SecurityOpt, Binds, VolumesFrom                          []string
	Devices                                                                   []any
	PortBindings                                                              map[string]any
	Mounts                                                                    []Mount
	Tmpfs                                                                     map[string]string
	ShmSize, Memory, MemorySwap, NanoCpus, PidsLimit                          int64
	Ulimits                                                                   []Ulimit
	RestartPolicy                                                             struct {
		Name              string
		MaximumRetryCount int
	}
	LogConfig struct {
		Type   string
		Config map[string]string
	}
}
type Config struct {
	Image, User, WorkingDir, Hostname string
	Entrypoint, Cmd, Env              []string
	Labels                            map[string]string
	Healthcheck                       struct{ Test []string }
}
type createBody struct {
	Config
	HostConfig       HostConfig
	NetworkingConfig map[string]any
}
type container struct {
	ID          string `json:"Id"`
	Name, Image string
	Config      Config
	HostConfig  HostConfig
	State       struct {
		Status                            string
		Running, Paused, Restarting, Dead bool
		ExitCode                          int
		Error                             string
	}
	NetworkSettings struct {
		Networks map[string]struct{ NetworkID string }
	}
	Mounts []struct {
		Type, Source, Destination string
		RW                        bool
	}
}
type imageInfo struct {
	ID               string `json:"Id"`
	RepoDigests      []string
	Os, Architecture string
	Size             int64
	Config           struct {
		Entrypoint, Cmd, Env []string
		Labels               map[string]string
		Volumes              map[string]any
	}
}

func (d *Driver) image(ctx context.Context, s lifecycle.Spec) (imageInfo, error) {
	var i imageInfo
	err := d.client.Do(ctx, "GET", "/images/"+dockerapi.Escape(s.Image)+"/json", nil, &i)
	if err != nil {
		return i, err
	}
	if !slices.Contains(i.RepoDigests, s.Image) || i.Os != "linux" || i.Architecture != runtime.GOARCH || i.Size <= 0 || i.Size > 16<<30 {
		return i, errors.New("Docker 镜像摘要、架构或大小不符合要求")
	}
	if len(i.Config.Volumes) != 0 {
		return i, errors.New("镜像声明了匿名卷，请使用不含 VOLUME 指令的环境镜像")
	}
	if len(i.Config.Entrypoint)+len(i.Config.Cmd) == 0 {
		return i, errors.New("镜像缺少启动命令")
	}
	return i, nil
}
func (d *Driver) Prepare(ctx context.Context, s lifecycle.Spec) error {
	if err := s.Validate(); err != nil {
		return err
	}
	info, err := d.client.Info(ctx)
	if err != nil {
		return err
	}
	if err = info.Validate(); err != nil {
		return err
	}
	if s.NetworkPolicy == "public-only" {
		if err = dockernet.Check(ctx); err != nil {
			return err
		}
	}
	if _, err = d.volumes.Ensure(ctx, s); err != nil {
		return err
	}
	unlock, err := d.cacheLock()
	if err != nil {
		return err
	}
	defer unlock()
	if _, err = d.image(ctx, s); err == nil {
		return d.touchImage(s.Image, false)
	} else if !dockerapi.NotFound(err) {
		return err
	}
	if err = d.prepareCache(ctx, s.Image); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	stream, err := d.client.Stream(ctx, "POST", "/images/create?fromImage="+url.QueryEscape(s.Image)+"&platform="+url.QueryEscape("linux/"+runtime.GOARCH), nil)
	if err != nil {
		return err
	}
	defer stream.Close()
	dec := json.NewDecoder(io.LimitReader(stream, 64<<20))
	for {
		var event struct{ Error string }
		err = dec.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if event.Error != "" {
			return fmt.Errorf("Docker 拉取镜像失败：%s", event.Error)
		}
	}
	if _, err = d.image(ctx, s); err != nil {
		return err
	}
	return d.touchImage(s.Image, true)
}
func build(s lifecycle.Spec, i imageInfo, mounts []storage.Mount, resolver string) createBody {
	c := Config{Image: s.Image, User: "1000:1000", WorkingDir: "/workspace", Hostname: "monkeyai", Labels: labels(s), Entrypoint: i.Config.Entrypoint, Cmd: i.Config.Cmd}
	// Docker 会继承镜像标签，engine 的归属标签始终覆盖同名镜像标签。
	for key, value := range i.Config.Labels {
		if _, managed := c.Labels[key]; !managed {
			c.Labels[key] = value
		}
	}
	c.Healthcheck.Test = []string{"NONE"}
	for _, e := range i.Config.Env {
		if !strings.HasPrefix(e, "HOME=") && !strings.HasPrefix(e, "USER=") && !strings.HasPrefix(e, "LOGNAME=") {
			c.Env = append(c.Env, e)
		}
	}
	if s.Runtime != nil {
		c.Entrypoint = []string{"/usr/bin/tini", "-g", "--"}
		c.Cmd = []string{"/bin/sleep", "infinity"}
		c.Env = nil
		for _, e := range i.Config.Env {
			key, _, ok := strings.Cut(e, "=")
			if ok && key != "PATH" && key != "LANG" && key != "HOME" && key != "USER" && key != "LOGNAME" {
				c.Env = append(c.Env, key+"=")
			}
		}
		c.Env = append(c.Env, "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8")
	}
	c.Env = append(c.Env, "HOME=/home/monkey", "USER=monkey", "LOGNAME=monkey")
	h := HostConfig{Runtime: dockerapi.Runtime, ReadonlyRootfs: true, NetworkMode: "none", CgroupnsMode: "private", IpcMode: "private", CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Memory: s.Resource.MemoryBytes, MemorySwap: s.Resource.MemoryBytes, NanoCpus: s.Resource.CPUMillis * 1000000, PidsLimit: s.Resource.HostTasks, ShmSize: s.Resource.TemporaryBytes / 4, Ulimits: []Ulimit{{"nofile", 4096, 4096}, {"nproc", sandboxTasks, sandboxTasks}}, Tmpfs: map[string]string{"/tmp": fmt.Sprintf("rw,nosuid,nodev,mode=1777,size=%d", s.Resource.TemporaryBytes/2), "/run": fmt.Sprintf("rw,nosuid,nodev,mode=1777,size=%d", s.Resource.TemporaryBytes/4)}}
	h.RestartPolicy.Name = "no"
	h.LogConfig.Type = "json-file"
	h.LogConfig.Config = map[string]string{"max-size": "10m", "max-file": "1"}
	for _, m := range mounts {
		v := Mount{Type: "bind", Source: m.Source, Target: m.Target}
		v.BindOptions.Propagation = "rprivate"
		h.Mounts = append(h.Mounts, v)
	}
	body := createBody{Config: c, HostConfig: h}
	if s.NetworkPolicy == "public-only" {
		body.HostConfig.Mounts = append(body.HostConfig.Mounts, Mount{Type: "bind", Source: resolver, Target: "/etc/resolv.conf", ReadOnly: true})
		body.HostConfig.NetworkMode = instanceKey(s)
		body.NetworkingConfig = map[string]any{"EndpointsConfig": map[string]any{instanceKey(s): map[string]any{}}}
	}
	return body
}
func validateMounts(s lifecycle.Spec, mounts []storage.Mount) error {
	if len(mounts) != len(s.Volumes) {
		return errors.New("持久卷数量不匹配")
	}
	seen := map[string]bool{}
	for _, m := range mounts {
		if !filepath.IsAbs(m.Source) || filepath.Clean(m.Source) != m.Source || m.Source == "/" || seen[m.Target] || !slices.ContainsFunc(s.Volumes, func(v lifecycle.Volume) bool { return v.Target() == m.Target }) {
			return errors.New("持久卷挂载无效")
		}
		seen[m.Target] = true
	}
	return nil
}
func (d *Driver) load(ctx context.Context, s lifecycle.Spec, ref string) (container, error) {
	var c container
	if err := s.Validate(); err != nil {
		return c, err
	}
	if ref != "" && ref != instanceKey(s) && ref != containerName(s) {
		return c, errors.New("实例引用不匹配")
	}
	err := d.client.Do(ctx, "GET", "/containers/"+containerName(s)+"/json", nil, &c)
	if dockerapi.NotFound(err) {
		err = d.client.Do(ctx, "GET", "/containers/"+instanceKey(s)+"/json", nil, &c)
	}
	if err != nil {
		return c, err
	}
	if !owned(c.Config.Labels, s) || c.Config.Image != s.Image || (c.Name != "/"+containerName(s) && c.Name != "/"+instanceKey(s)) {
		return c, errors.New("Docker 容器归属或镜像不一致")
	}
	i, err := d.image(ctx, s)
	if err != nil {
		return c, err
	}
	if i.ID != c.Image {
		return c, errors.New("Docker 容器镜像内容发生变化")
	}
	mounts, err := d.volumes.Ensure(ctx, s)
	if err != nil {
		return c, err
	}
	want := build(s, i, mounts, filepath.Join(d.instanceDir(s), "resolv.conf"))
	// 旧容器的日志驱动不能原地修改；保留其管理能力，新实例统一启用有界日志。
	if c.Name == "/"+instanceKey(s) && c.HostConfig.LogConfig.Type == "none" {
		want.HostConfig.LogConfig.Type = "none"
		want.HostConfig.LogConfig.Config = nil
	}
	// Docker 会补充默认 log 配置与空集合，按 JSON 的非空集合统一比较。
	if !equivalent(c.HostConfig, want.HostConfig) || !equivalent(c.Config, want.Config) {
		return c, errors.New("Docker 容器安全配置或资源限制发生变化")
	}
	bindCount := 0
	for _, m := range c.Mounts {
		if m.Type == "bind" {
			if s.NetworkPolicy == "public-only" && m.Source == filepath.Join(d.instanceDir(s), "resolv.conf") && m.Destination == "/etc/resolv.conf" && !m.RW {
				continue
			}
			bindCount++
		} else if m.Type != "tmpfs" || (m.Destination != "/tmp" && m.Destination != "/run") {
			return c, errors.New("Docker 存在额外挂载")
		}
	}
	if bindCount != len(mounts) {
		return c, errors.New("Docker 存在额外挂载")
	}
	for _, m := range mounts {
		if !slices.ContainsFunc(c.Mounts, func(v struct {
			Type, Source, Destination string
			RW                        bool
		}) bool {
			return v.Type == "bind" && v.Source == m.Source && v.Destination == m.Target && v.RW
		}) {
			return c, errors.New("Docker 持久卷挂载发生变化")
		}
	}
	if s.NetworkPolicy == "public-only" {
		if len(c.NetworkSettings.Networks) != 1 {
			return c, errors.New("Docker 网络连接不一致")
		}
		if _, ok := c.NetworkSettings.Networks[instanceKey(s)]; !ok {
			return c, errors.New("Docker 网络归属不一致")
		}
	}
	return c, nil
}
func equivalent(a, b any) bool {
	var x, y any
	raw, _ := json.Marshal(a)
	_ = json.Unmarshal(raw, &x)
	raw, _ = json.Marshal(b)
	_ = json.Unmarshal(raw, &y)
	normalize(x)
	normalize(y)
	return reflect.DeepEqual(x, y)
}
func normalize(v any) {
	if m, ok := v.(map[string]any); ok {
		for k, x := range m {
			switch a := x.(type) {
			case []any:
				if len(a) == 0 {
					m[k] = nil
				} else {
					for _, v := range a {
						normalize(v)
					}
				}
			case map[string]any:
				if len(a) == 0 {
					m[k] = nil
				} else {
					normalize(a)
				}
			}
		}
	}
}
func (d *Driver) Create(ctx context.Context, s lifecycle.Spec) (string, error) {
	if c, err := d.load(ctx, s, ""); err == nil {
		return strings.TrimPrefix(c.Name, "/"), nil
	} else if !dockerapi.NotFound(err) {
		return "", err
	}
	if _, err := os.Lstat(filepath.Join(d.root, "retired", instanceKey(s))); err == nil {
		return "", errors.New("实例已回收，启动需要新的实例标识")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	mounts, err := d.volumes.Ensure(ctx, s)
	if err != nil {
		return "", err
	}
	if err = validateMounts(s, mounts); err != nil {
		return "", err
	}
	i, err := d.image(ctx, s)
	if err != nil {
		return "", err
	}
	dir := d.instanceDir(s)
	if err = storage.PrivateDir(dir); err != nil {
		return "", err
	}
	p := filepath.Join(dir, "spec.json")
	raw, err := os.ReadFile(p)
	if err == nil && string(raw) != fingerprint(s) {
		return "", errors.New("实例目录已绑定其他规格")
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err = control.Write(p, []byte(fingerprint(s)), 0600); err != nil {
		return "", err
	}
	if s.NetworkPolicy == "public-only" {
		n, e := dockernet.Ensure(ctx, d.client, instanceKey(s), fingerprint(s), containerName(s))
		if e != nil {
			return "", e
		}
		if err = control.Write(filepath.Join(dir, "resolv.conf"), []byte(n.Resolver()), 0644); err != nil {
			return "", err
		}
	}
	var out struct {
		ID string `json:"Id"`
	}
	if err = d.client.Do(ctx, "POST", "/containers/create?name="+url.QueryEscape(containerName(s)), build(s, i, mounts, filepath.Join(d.instanceDir(s), "resolv.conf")), &out); err != nil {
		return "", err
	}
	return containerName(s), nil
}
func (d *Driver) guard(ctx context.Context, s lifecycle.Spec, name string) error {
	if s.NetworkPolicy != "public-only" {
		return nil
	}
	n, err := dockernet.Inspect(ctx, d.client, instanceKey(s), fingerprint(s), name)
	if err != nil {
		return err
	}
	return dockernet.Guard(ctx, n, fingerprint(s))
}
func (d *Driver) Start(ctx context.Context, s lifecycle.Spec, ref string) error {
	c, err := d.load(ctx, s, ref)
	if err != nil {
		return err
	}
	if err = d.guard(ctx, s, strings.TrimPrefix(c.Name, "/")); err != nil {
		return err
	}
	if c.State.Running {
		return nil
	}
	if c.State.Status != "created" {
		return errors.New("已退出的实例不能自动重新执行")
	}
	return d.client.Do(ctx, "POST", "/containers/"+c.ID+"/start", nil, nil)
}
func (d *Driver) Stop(ctx context.Context, s lifecycle.Spec, ref string) error {
	c, err := d.load(ctx, s, ref)
	if dockerapi.NotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if c.State.Paused {
		if err = d.client.Do(ctx, "POST", "/containers/"+c.ID+"/unpause", nil, nil); err != nil {
			return err
		}
	}
	if c.State.Running {
		if err = d.client.Do(ctx, "POST", "/containers/"+c.ID+"/stop?t=20", nil, nil); err != nil {
			return err
		}
	}
	c, err = d.load(ctx, s, ref)
	if err == nil && c.State.Running {
		return errors.New("未确认 Docker 容器退出")
	}
	return err
}
func (d *Driver) Inspect(ctx context.Context, s lifecycle.Spec, ref string) (lifecycle.Instance, error) {
	c, err := d.load(ctx, s, ref)
	if dockerapi.NotFound(err) {
		raw, e := os.ReadFile(filepath.Join(d.instanceDir(s), "spec.json"))
		if e == nil && string(raw) == fingerprint(s) {
			if ref == "" {
				ref = containerName(s)
			}
			return lifecycle.Instance{Ref: ref, Phase: lifecycle.InstanceStopped}, nil
		}
		if errors.Is(e, os.ErrNotExist) {
			return lifecycle.Instance{Phase: lifecycle.InstanceAbsent}, nil
		}
		return lifecycle.Instance{}, errors.New("实例控制记录不一致")
	}
	if err != nil {
		return lifecycle.Instance{}, err
	}
	i := lifecycle.Instance{Ref: strings.TrimPrefix(c.Name, "/"), Phase: lifecycle.InstanceStopped}
	if c.State.Status == "created" {
		i.Phase = lifecycle.InstanceCreated
	}
	if c.State.Running {
		i.Phase = lifecycle.InstanceRunning
	}
	if i.Phase == lifecycle.InstanceRunning && s.DesiredState == lifecycle.DesiredRunning {
		if err = d.guard(ctx, s, strings.TrimPrefix(c.Name, "/")); err != nil {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			return i, errors.Join(err, d.client.Do(cleanup, "POST", "/containers/"+c.ID+"/kill?signal=SIGKILL", nil, nil))
		}
	}
	return i, nil
}
func (d *Driver) Remove(ctx context.Context, s lifecycle.Spec, ref string) error {
	c, err := d.load(ctx, s, ref)
	if err != nil && !dockerapi.NotFound(err) {
		return err
	}
	if err == nil {
		if c.State.Running {
			return errors.New("容器仍在运行，拒绝删除")
		}
		if err = d.client.Do(ctx, "DELETE", "/containers/"+c.ID+"?force=false&v=false", nil, nil); err != nil {
			return err
		}
	}
	p := filepath.Join(d.instanceDir(s), "spec.json")
	raw, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if string(raw) != fingerprint(s) {
		return errors.New("实例控制目录归属不一致")
	}
	if s.NetworkPolicy == "public-only" {
		if err = dockernet.Remove(ctx, d.client, instanceKey(s), fingerprint(s), containerName(s)); err != nil {
			return err
		}
	}
	if err = storage.PrivateDir(filepath.Join(d.root, "retired")); err != nil {
		return err
	}
	if err = control.Write(filepath.Join(d.root, "retired", instanceKey(s)), []byte(fingerprint(s)), 0600); err != nil {
		return err
	}
	for _, name := range []string{"serve.json", "resolv.conf", "spec.json"} {
		if err = os.Remove(filepath.Join(d.instanceDir(s), name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return os.Remove(d.instanceDir(s))
}
