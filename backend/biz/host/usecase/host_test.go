package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/host/repo"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestGetInstallCommandStoresTokenForTwoHours(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	u := &HostUsecase{
		cfg: &config.Config{
			Server: struct {
				Addr    string `mapstructure:"addr"`
				BaseURL string `mapstructure:"base_url"`
			}{BaseURL: "http://monkeycode.local"},
		},
		redis: rdb,
	}

	cmd, err := u.GetInstallCommand(ctx, &domain.User{ID: uuid.New(), Name: "tester"})
	if err != nil {
		t.Fatal(err)
	}
	token := installTokenFromCommand(t, cmd)
	ttl, err := rdb.TTL(ctx, "host:token:"+token).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttl != 2*time.Hour {
		t.Fatalf("host install token ttl = %s, want %s", ttl, 2*time.Hour)
	}
}

func TestInstallScriptDefaultsToOnlineInstaller(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	token := "install-token"
	if err := rdb.Set(context.Background(), "host:token:"+token, "1", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	u := &HostUsecase{
		cfg: &config.Config{
			TaskFlow: config.TaskFlow{GrpcURL: "121.41.208.82:50443"},
		},
		redis: rdb,
	}

	script, err := u.InstallScript(context.Background(), &domain.InstallReq{Token: token})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "release.baizhi.cloud/monkeycode/runner/$ARCH/installer") {
		t.Fatalf("script missing online installer: %s", script)
	}
	if !strings.Contains(script, "--env GRPC_URL=121.41.208.82:50443") {
		t.Fatalf("script missing grpc url: %s", script)
	}
	if strings.Contains(script, "install_docker_from_bundle") {
		t.Fatalf("online script should not include offline installer: %s", script)
	}
	assertInstallScriptChecksAVX(t, script)
}

func TestInstallScriptUsesOfflineBundle(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	token := "install-token"
	if err := rdb.Set(context.Background(), "host:token:"+token, "1", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	u := &HostUsecase{
		cfg: &config.Config{
			Server: struct {
				Addr    string `mapstructure:"addr"`
				BaseURL string `mapstructure:"base_url"`
			}{BaseURL: "http://monkeycode.local"},
			TaskFlow: config.TaskFlow{GrpcURL: "121.41.208.82:50443"},
			StaticFiles: config.StaticFilesConfig{
				RoutePrefix: "/static",
			},
			HostInstaller: config.HostInstaller{
				Mode:       "offline",
				BundlePath: "installer/{{.arch}}/host.tgz",
			},
		},
		redis: rdb,
	}

	script, err := u.InstallScript(context.Background(), &domain.InstallReq{Token: token})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "GRPC_URL=\"121.41.208.82:50443\"") {
		t.Fatalf("script missing grpc url: %s", script)
	}
	if !strings.Contains(script, "INSTALLER_URL=\"http://monkeycode.local/static/installer/{{.arch}}/installer\"") {
		t.Fatalf("script missing installer url: %s", script)
	}
	if !strings.Contains(script, "BASE_URL=\"http://monkeycode.local\"") || !strings.Contains(script, "MCAI_BASE_URL=\"$BASE_URL\"") {
		t.Fatalf("script missing base url: %s", script)
	}
	if !strings.Contains(script, "HOST_BUNDLE_PATH=\"/static/installer/{{.arch}}/host.tgz\"") || !strings.Contains(script, "HOST_BUNDLE_PATH=${HOST_BUNDLE_PATH//\\{\\{.arch\\}\\}/$ARCH}") || !strings.Contains(script, "MCAI_HOST_BUNDLE_PATH=\"$HOST_BUNDLE_PATH\"") {
		t.Fatalf("script missing host bundle path: %s", script)
	}
	if !strings.Contains(script, "DOCKER_BUNDLE_PATH=\"/static/installer/{{.arch}}/docker.tgz\"") || !strings.Contains(script, "DOCKER_BUNDLE_PATH=${DOCKER_BUNDLE_PATH//\\{\\{.arch\\}\\}/$ARCH}") || !strings.Contains(script, "MCAI_DOCKER_BUNDLE_PATH=\"$DOCKER_BUNDLE_PATH\"") {
		t.Fatalf("script missing docker bundle path: %s", script)
	}
	if !strings.Contains(script, "TOKEN=\"install-token\"") || !strings.Contains(script, "MCAI_HOST_TOKEN=\"$TOKEN\"") {
		t.Fatalf("script missing host token: %s", script)
	}
	if strings.Contains(script, "docker load") || strings.Contains(script, "docker compose") {
		t.Fatalf("bootstrap script should not install host directly: %s", script)
	}
	if strings.Contains(script, "release.baizhi.cloud") {
		t.Fatalf("script should not download public installer: %s", script)
	}
	assertInstallScriptChecksAVX(t, script)
}

func TestInstallScriptIncludesExtensionImagesManifestPath(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	token := "install-token"
	teamID := uuid.New()
	rawUser, err := json.Marshal(&domain.User{
		ID: uuid.New(),
		Team: &domain.Team{
			ID: teamID,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(context.Background(), "host:token:"+token, string(rawUser), time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	u := &HostUsecase{
		cfg: &config.Config{
			Server: struct {
				Addr    string `mapstructure:"addr"`
				BaseURL string `mapstructure:"base_url"`
			}{BaseURL: "http://monkeycode.local"},
			TaskFlow: config.TaskFlow{GrpcURL: "127.0.0.1:50443"},
			StaticFiles: config.StaticFilesConfig{
				RoutePrefix: "/static",
			},
			HostInstaller: config.HostInstaller{
				Mode:       "offline",
				BundlePath: "installer/{{.arch}}/host.tgz",
			},
		},
		redis: rdb,
	}

	script, err := u.InstallScript(context.Background(), &domain.InstallReq{Token: token})
	if err != nil {
		t.Fatal(err)
	}
	want := "/static/extensions/teams/" + teamID.String() + "/images/{{.arch}}/manifest.json"
	if !strings.Contains(script, "EXTENSION_IMAGES_MANIFEST_PATH=\""+want+"\"") {
		t.Fatalf("script missing extension manifest path %q:\n%s", want, script)
	}
	if !strings.Contains(script, "EXTENSION_IMAGES_MANIFEST_PATH=${EXTENSION_IMAGES_MANIFEST_PATH//\\{\\{.arch\\}\\}/$ARCH}") {
		t.Fatalf("script missing extension manifest arch replacement:\n%s", script)
	}
	if !strings.Contains(script, "MCAI_EXTENSION_IMAGES_MANIFEST_PATH=\"$EXTENSION_IMAGES_MANIFEST_PATH\"") {
		t.Fatalf("script missing installer extension manifest env:\n%s", script)
	}
}

func assertInstallScriptChecksAVX(t *testing.T, script string) {
	t.Helper()

	for _, want := range []string{
		"check_avx_support",
		"/proc/cpuinfo",
		"grep -qiE '(^|[[:space:]])avx([[:space:]]|$)' /proc/cpuinfo",
		"Current CPU does not support AVX instructions",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("install script missing AVX check %q:\n%s", want, script)
		}
	}

	checkIndex := strings.Index(script, "check_avx_support\n")
	curlIndex := strings.Index(script, "curl -4")
	if checkIndex == -1 || curlIndex == -1 || checkIndex > curlIndex {
		t.Fatalf("install script should check AVX before downloading installer:\n%s", script)
	}
}

func installTokenFromCommand(t *testing.T, cmd string) string {
	t.Helper()

	start := strings.Index(cmd, "'")
	end := strings.LastIndex(cmd, "'")
	if start == -1 || end <= start {
		t.Fatalf("install command missing quoted url: %s", cmd)
	}
	u, err := url.Parse(cmd[start+1 : end])
	if err != nil {
		t.Fatalf("parse install command url: %v", err)
	}
	token := u.Query().Get("token")
	if token == "" {
		t.Fatalf("install command missing token: %s", cmd)
	}
	return token
}

func TestHostUsecase_markRecycledTasksFinished(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:host-usecase-task-finish-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	createTask := func(status consts.TaskStatus) *db.Task {
		taskID := uuid.New()
		tk, err := client.Task.Create().
			SetID(taskID).
			SetUserID(userID).
			SetKind(consts.TaskTypeDevelop).
			SetContent(string(status)).
			SetStatus(status).
			Save(ctx)
		if err != nil {
			t.Fatalf("create task(%s): %v", status, err)
		}
		return tk
	}

	processingTask := createTask(consts.TaskStatusProcessing)
	finishedTask := createTask(consts.TaskStatusFinished)
	errorTask := createTask(consts.TaskStatusError)

	taskRepo := &hostTaskRepoStub{client: client}
	u := &HostUsecase{
		taskRepo: taskRepo,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	vm := &db.VirtualMachine{
		ID: "vm-1",
		Edges: db.VirtualMachineEdges{
			Tasks: []*db.Task{
				processingTask,
				finishedTask,
				errorTask,
				nil,
			},
		},
	}

	if err := u.markRecycledTasksFinished(ctx, vm); err != nil {
		t.Fatalf("markRecycledTasksFinished() error = %v", err)
	}

	gotProcessing, err := client.Task.Get(ctx, processingTask.ID)
	if err != nil {
		t.Fatalf("query processing task: %v", err)
	}
	if gotProcessing.Status != consts.TaskStatusFinished {
		t.Fatalf("processing task status = %s, want %s", gotProcessing.Status, consts.TaskStatusFinished)
	}
	if gotProcessing.CompletedAt.IsZero() {
		t.Fatal("expected processing task completed_at to be set")
	}

	gotFinished, err := client.Task.Get(ctx, finishedTask.ID)
	if err != nil {
		t.Fatalf("query finished task: %v", err)
	}
	if !gotFinished.CompletedAt.IsZero() {
		t.Fatal("expected already finished task completed_at to remain unchanged")
	}

	gotError, err := client.Task.Get(ctx, errorTask.ID)
	if err != nil {
		t.Fatalf("query error task: %v", err)
	}
	if gotError.Status != consts.TaskStatusError {
		t.Fatalf("error task status = %s, want %s", gotError.Status, consts.TaskStatusError)
	}

	if len(taskRepo.updatedIDs) != 1 || taskRepo.updatedIDs[0] != processingTask.ID {
		t.Fatalf("updated task ids = %v, want only %s", taskRepo.updatedIDs, processingTask.ID)
	}
}

func TestHostUsecase_CreateVMPreinsertsVirtualMachineBeforeTaskflowCreate(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:host-usecase-create-vm-preinsert-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	imageID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := client.Host.Create().
		SetID("host-1").
		SetUserID(userID).
		SetHostname("host").
		Save(ctx); err != nil {
		t.Fatalf("create host: %v", err)
	}
	if _, err := client.Image.Create().
		SetID(imageID).
		SetUserID(userID).
		SetName("image").
		Save(ctx); err != nil {
		t.Fatalf("create image: %v", err)
	}

	i := do.New()
	do.ProvideValue(i, &config.Config{})
	do.ProvideValue(i, client)
	do.ProvideValue(i, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	do.ProvideValue(i, rdb)
	hostRepo, err := repo.NewHostRepo(i)
	if err != nil {
		t.Fatalf("new host repo: %v", err)
	}

	vmCreate := &preinsertVMCreateStub{db: client}
	u := &HostUsecase{
		cfg:      &config.Config{},
		repo:     hostRepo,
		taskflow: &preinsertTaskflowStub{vm: vmCreate},
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	vm, err := u.CreateVM(ctx, &domain.User{ID: userID}, &domain.CreateVMReq{
		HostID:  "host-1",
		ImageID: imageID,
		Name:    "manual-vm",
		Resource: &domain.Resource{
			CPU:    2,
			Memory: 4096,
		},
	})
	if err != nil {
		t.Fatalf("CreateVM() error = %v", err)
	}
	if vmCreate.seenID == "" {
		t.Fatal("expected taskflow create to receive preallocated vm id")
	}
	if vm.ID != vmCreate.seenID {
		t.Fatalf("created vm id = %q, want %q", vm.ID, vmCreate.seenID)
	}
}

type hostTaskRepoStub struct {
	client     *db.Client
	updatedIDs []uuid.UUID
}

func (s *hostTaskRepoStub) GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error) {
	return s.client.Task.Get(ctx, id)
}

func (s *hostTaskRepoStub) GetLogStore(ctx context.Context, id uuid.UUID) (consts.LogStore, error) {
	tk, err := s.client.Task.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if tk.LogStore == nil {
		return "", nil
	}
	return *tk.LogStore, nil
}

func (s *hostTaskRepoStub) Stat(context.Context, uuid.UUID) (*domain.TaskStats, error) {
	panic("unexpected call to Stat")
}

func (s *hostTaskRepoStub) StatByIDs(context.Context, []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	panic("unexpected call to StatByIDs")
}

func (s *hostTaskRepoStub) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	panic("unexpected call to Info")
}

func (s *hostTaskRepoStub) List(context.Context, *domain.User, domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	panic("unexpected call to List")
}

func (s *hostTaskRepoStub) Create(context.Context, *domain.User, domain.CreateTaskReq, string, func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	panic("unexpected call to Create")
}

func (s *hostTaskRepoStub) PrepareCreate(context.Context, *domain.User, domain.CreateTaskReq, string, string) (*domain.PreparedProjectTask, error) {
	panic("unexpected call to PrepareCreate")
}

func (s *hostTaskRepoStub) CompleteCreate(context.Context, string, *taskflow.VirtualMachine) error {
	panic("unexpected call to CompleteCreate")
}

func (s *hostTaskRepoStub) Update(ctx context.Context, _ *domain.User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error {
	s.updatedIDs = append(s.updatedIDs, id)
	up := s.client.Task.UpdateOneID(id)
	if err := fn(up); err != nil {
		return err
	}
	return up.Exec(ctx)
}

func (s *hostTaskRepoStub) RefreshLastActiveAt(context.Context, uuid.UUID, time.Time, time.Duration) error {
	panic("unexpected call to RefreshLastActiveAt")
}

func (s *hostTaskRepoStub) Stop(context.Context, *domain.User, uuid.UUID, func(*db.Task) error) error {
	panic("unexpected call to Stop")
}

func (s *hostTaskRepoStub) Delete(context.Context, *domain.User, uuid.UUID) error {
	panic("unexpected call to Delete")
}

func (s *hostTaskRepoStub) UpdateProjectTaskModel(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected call to UpdateProjectTaskModel")
}

func (s *hostTaskRepoStub) CreateModelSwitch(context.Context, *domain.TaskModelSwitch) error {
	panic("unexpected call to CreateModelSwitch")
}

func (s *hostTaskRepoStub) FinishModelSwitch(context.Context, uuid.UUID, bool, string, string) error {
	panic("unexpected call to FinishModelSwitch")
}

func (s *hostTaskRepoStub) CompleteModelSwitch(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, bool, string, string) error {
	panic("unexpected call to CompleteModelSwitch")
}

type preinsertTaskflowStub struct {
	vm taskflow.VirtualMachiner
}

func (s *preinsertTaskflowStub) VirtualMachiner() taskflow.VirtualMachiner { return s.vm }
func (s *preinsertTaskflowStub) Host() taskflow.Hoster {
	return preinsertHosterStub{}
}
func (s *preinsertTaskflowStub) FileManager() taskflow.FileManager     { return nil }
func (s *preinsertTaskflowStub) TaskManager() taskflow.TaskManager     { return nil }
func (s *preinsertTaskflowStub) PortForwarder() taskflow.PortForwarder { return nil }
func (s *preinsertTaskflowStub) Stats(context.Context) (*taskflow.Stats, error) {
	return nil, nil
}
func (s *preinsertTaskflowStub) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return nil
}

type preinsertHosterStub struct{}

func (preinsertHosterStub) List(context.Context, string) (map[string]*taskflow.Host, error) {
	return nil, nil
}
func (preinsertHosterStub) IsOnline(_ context.Context, req *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	online := make(map[string]bool, len(req.IDs))
	for _, id := range req.IDs {
		online[id] = true
	}
	return &taskflow.IsOnlineResp{OnlineMap: online}, nil
}

type preinsertVMCreateStub struct {
	db     *db.Client
	seenID string
}

func (s *preinsertVMCreateStub) Create(ctx context.Context, req *taskflow.CreateVirtualMachineReq) (*taskflow.VirtualMachine, error) {
	if req.ID == "" {
		return nil, fmt.Errorf("taskflow create req id is empty")
	}
	if _, err := s.db.VirtualMachine.Get(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("virtual machine %s not visible before taskflow create: %w", req.ID, err)
	}
	s.seenID = req.ID
	return &taskflow.VirtualMachine{
		ID:            req.ID,
		AccessToken:   "access-" + req.ID,
		EnvironmentID: "env-" + req.ID,
		HostID:        req.HostID,
	}, nil
}
func (s *preinsertVMCreateStub) Delete(context.Context, *taskflow.DeleteVirtualMachineReq) error {
	return nil
}
func (s *preinsertVMCreateStub) Hibernate(context.Context, *taskflow.HibernateVirtualMachineReq) error {
	return nil
}
func (s *preinsertVMCreateStub) Resume(context.Context, *taskflow.ResumeVirtualMachineReq) error {
	return nil
}
func (s *preinsertVMCreateStub) List(context.Context, string) ([]*taskflow.VirtualMachine, error) {
	return nil, nil
}
func (s *preinsertVMCreateStub) Info(context.Context, taskflow.VirtualMachineInfoReq) (*taskflow.VirtualMachine, error) {
	return nil, nil
}
func (s *preinsertVMCreateStub) Terminal(context.Context, *taskflow.TerminalReq) (taskflow.Sheller, error) {
	return nil, nil
}
func (s *preinsertVMCreateStub) Reports(context.Context, taskflow.ReportSubscribeReq) (taskflow.Reporter, error) {
	return nil, nil
}
func (s *preinsertVMCreateStub) TerminalList(context.Context, string) ([]*taskflow.Terminal, error) {
	return nil, nil
}
func (s *preinsertVMCreateStub) CloseTerminal(context.Context, *taskflow.CloseTerminalReq) error {
	return nil
}
func (s *preinsertVMCreateStub) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	return nil, nil
}
