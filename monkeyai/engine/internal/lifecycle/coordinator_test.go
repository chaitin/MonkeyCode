package lifecycle

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type fakeDriver struct {
	instances map[string]Instance
	log       []string
	fail      string
}

func newFake() *fakeDriver { return &fakeDriver{instances: make(map[string]Instance)} }
func (d *fakeDriver) Prepare(context.Context, Spec) error {
	d.log = append(d.log, "prepare")
	return d.err("prepare")
}
func (d *fakeDriver) Create(_ context.Context, s Spec) (string, error) {
	d.log = append(d.log, "create")
	if err := d.err("create"); err != nil {
		return "", err
	}
	d.instances[s.InstanceID] = Instance{Ref: s.InstanceID, Phase: InstanceCreated}
	return s.InstanceID, nil
}
func (d *fakeDriver) Start(_ context.Context, _ Spec, ref string) error {
	d.log = append(d.log, "start")
	if err := d.err("start"); err != nil {
		return err
	}
	d.instances[ref] = Instance{Ref: ref, Phase: InstanceRunning}
	return nil
}
func (d *fakeDriver) Stop(_ context.Context, _ Spec, ref string) error {
	d.log = append(d.log, "stop")
	if err := d.err("stop"); err != nil {
		return err
	}
	d.instances[ref] = Instance{Ref: ref, Phase: InstanceStopped}
	return nil
}
func (d *fakeDriver) Inspect(_ context.Context, s Spec, ref string) (Instance, error) {
	d.log = append(d.log, "inspect")
	if err := d.err("inspect"); err != nil {
		return Instance{}, err
	}
	if ref == "" {
		ref = s.InstanceID
	}
	i, ok := d.instances[ref]
	if !ok {
		return Instance{Phase: InstanceAbsent}, nil
	}
	return i, nil
}
func (d *fakeDriver) Remove(_ context.Context, _ Spec, ref string) error {
	d.log = append(d.log, "remove")
	if err := d.err("remove"); err != nil {
		return err
	}
	delete(d.instances, ref)
	return nil
}
func (d *fakeDriver) err(op string) error {
	if d.fail == op {
		return errors.New("驱动失败")
	}
	return nil
}

func testSpec() Spec {
	return Spec{EnvironmentID: "env-1", InstanceID: "instance-1", Generation: 1, DesiredState: DesiredRunning, Driver: "gvisor", ImageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Image: "registry.example/image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", NetworkPolicy: "isolated", Resource: Resource{CPUMillis: 1000, MemoryBytes: 512 << 20, HostTasks: 256, TemporaryBytes: 64 << 20}, Volumes: []Volume{{"workspace-1", "workspace", 1 << 30, 10000}, {"home-1", "home", 1 << 30, 10000}, {"runtime-1", "runtime", 1 << 30, 10000}}}
}

func TestCoordinatorLifecycleIsIdempotent(t *testing.T) {
	root := privateDir(t)
	driver := newFake()
	c, err := NewCoordinator(FileStore{Root: root}, driver)
	if err != nil {
		t.Fatal(err)
	}
	state, err := c.Apply(context.Background(), testSpec())
	if err != nil || state.Phase != PhaseRunning {
		t.Fatalf("启动失败: %#v %v", state, err)
	}
	state, err = c.Apply(context.Background(), testSpec())
	if err != nil || state.Phase != PhaseRunning {
		t.Fatalf("重复启动失败: %#v %v", state, err)
	}
	creates := 0
	for _, op := range driver.log {
		if op == "create" {
			creates++
		}
	}
	if creates != 1 {
		t.Fatalf("重复启动不应创建实例，日志=%v", driver.log)
	}

	stopped := testSpec()
	stopped.DesiredState = DesiredStopped
	stopped.Generation = 2
	state, err = c.Apply(context.Background(), stopped)
	if err != nil || state.Phase != PhaseStopped {
		t.Fatalf("停止失败: %#v %v", state, err)
	}
	deleted := stopped
	deleted.DesiredState = DesiredDeleted
	deleted.Generation = 3
	state, err = c.Apply(context.Background(), deleted)
	if err != nil || state.Phase != PhaseDeleted {
		t.Fatalf("删除失败: %#v %v", state, err)
	}
}

func TestCoordinatorRejectsStaleGeneration(t *testing.T) {
	c, err := NewCoordinator(FileStore{Root: privateDir(t)}, newFake())
	if err != nil {
		t.Fatal(err)
	}
	current := testSpec()
	current.Generation = 2
	if _, err := c.Apply(context.Background(), current); err != nil {
		t.Fatal(err)
	}
	stale := testSpec()
	stale.Generation = 1
	_, err = c.Apply(context.Background(), stale)
	if !errors.Is(err, ErrStaleGeneration) {
		t.Fatalf("应拒绝旧代次，得到 %v", err)
	}
}

func TestFileStoreAtomicAndPrivate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "state")
	store := FileStore{Root: root}
	if err := store.Save("env-1", State{Spec: testSpec(), Phase: PhasePending}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "env-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("状态文件权限为 %o", info.Mode().Perm())
	}
	if _, err := store.Load("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("缺少状态应返回 ErrNotFound，得到 %v", err)
	}
}

type interruptedStore struct {
	FileStore
	failed bool
}

func (s *interruptedStore) Save(id string, state State) error {
	if !s.failed && state.ProviderRef != "" {
		s.failed = true
		return errors.New("模拟引用持久化中断")
	}
	return s.FileStore.Save(id, state)
}

func TestRecoverCreatedInstanceAfterCheckpointFailure(t *testing.T) {
	store := &interruptedStore{FileStore: FileStore{Root: privateDir(t)}}
	driver := newFake()
	c, _ := NewCoordinator(store, driver)
	if _, err := c.Apply(t.Context(), testSpec()); err == nil {
		t.Fatal("应返回持久化失败")
	}
	c, _ = NewCoordinator(store, driver)
	state, err := c.Apply(t.Context(), testSpec())
	if err != nil || state.Phase != PhaseRunning {
		t.Fatalf("未恢复实例: %+v %v", state, err)
	}
	creates := 0
	for _, op := range driver.log {
		if op == "create" {
			creates++
		}
	}
	if creates != 1 {
		t.Fatalf("重复创建: %v", driver.log)
	}
}

func TestChangedSpecAtSameGenerationHasNoEffects(t *testing.T) {
	driver := newFake()
	c, _ := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	if _, err := c.Apply(t.Context(), testSpec()); err != nil {
		t.Fatal(err)
	}
	calls := len(driver.log)
	spec := testSpec()
	spec.DesiredState = DesiredStopped
	if _, err := c.Apply(t.Context(), spec); !errors.Is(err, ErrGenerationConflict) {
		t.Fatalf("未拒绝同代次修改: %v", err)
	}
	if len(driver.log) != calls {
		t.Fatal("冲突请求触发驱动")
	}
}

func TestExitedInstanceDoesNotRestart(t *testing.T) {
	driver := newFake()
	c, _ := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	spec := testSpec()
	if _, err := c.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	driver.instances[spec.InstanceID] = Instance{Ref: spec.InstanceID, Phase: InstanceStopped}
	state, err := c.Apply(t.Context(), spec)
	if err == nil || state.Phase != PhaseFailed {
		t.Fatalf("未锁定失败代次: %+v %v", state, err)
	}
	calls := len(driver.log)
	if _, err := c.Apply(t.Context(), spec); !errors.Is(err, ErrFailedGeneration) {
		t.Fatalf("未拒绝自动重启: %v", err)
	}
	if len(driver.log) != calls {
		t.Fatal("失败代次重试触发驱动")
	}
}

func TestRestartRequiresStoppedAndNewInstance(t *testing.T) {
	driver := newFake()
	c, _ := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	spec := testSpec()
	if _, err := c.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	next := spec
	next.Generation = 2
	next.InstanceID = "instance-2"
	if _, err := c.Apply(t.Context(), next); !errors.Is(err, ErrInstanceConflict) {
		t.Fatalf("运行中不应更换实例: %v", err)
	}
	spec.Generation = 2
	spec.DesiredState = DesiredStopped
	if _, err := c.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	next.Generation = 3
	state, err := c.Apply(t.Context(), next)
	if err != nil || state.ProviderRef != next.InstanceID || len(driver.instances) != 1 {
		t.Fatalf("重启异常: %+v %v", state, err)
	}
}

func TestFileStoreRejectsMismatchedIdentityAndCorruption(t *testing.T) {
	store := FileStore{Root: privateDir(t)}
	if err := store.Save("another-env", State{Spec: testSpec(), Phase: PhasePending}); err == nil {
		t.Fatal("应拒绝错误身份")
	}
	if err := os.WriteFile(store.path("env-1"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load("env-1"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("损坏不能视为不存在: %v", err)
	}
}

func privateDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestImagePinsRemainUntilCleanupIsConfirmed(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := FileStore{Root: filepath.Join(root, "states")}
	s := testSpec()
	for _, phase := range []Phase{PhasePreparing, PhaseRunning, PhaseFailed, PhaseStopping, PhaseStopped, PhaseDeleted} {
		if err := store.Save(s.EnvironmentID, State{Spec: s, Phase: phase}); err != nil {
			t.Fatal(err)
		}
		pins, err := store.Images()
		if err != nil {
			t.Fatal(err)
		}
		if pins[s.Image] != (phase != PhaseStopped && phase != PhaseDeleted) {
			t.Fatal("镜像引用保护错误", phase, pins)
		}
	}
	if err := os.WriteFile(filepath.Join(store.Root, "broken.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Images(); err == nil {
		t.Fatal("损坏状态仍允许镜像回收")
	}
}
