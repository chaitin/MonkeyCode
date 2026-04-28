package usecase

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestSwitchModelRestartsWithExecutionConfigAndUpdatesModel(t *testing.T) {
	ctx := context.Background()
	userID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	taskID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	fromModelID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	toModelID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	switchID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	restartTaskID := uuid.MustParse("77777777-7777-7777-7777-777777777777")

	repo := &switchModelTaskRepo{
		task: &db.Task{
			ID:           taskID,
			UserID:       userID,
			Status:       consts.TaskStatusProcessing,
			CreatedAt:    time.Now(),
			LastActiveAt: time.Now(),
			Edges: db.TaskEdges{
				Vms: []*db.VirtualMachine{
					{ID: "vm-1", CreatedAt: time.Now()},
				},
				ProjectTasks: []*db.ProjectTask{
					{
						TaskID:  taskID,
						ModelID: fromModelID,
						CliName: consts.CliNameOpencode,
						Edges: db.ProjectTaskEdges{
							Model: &db.Model{ID: fromModelID},
						},
					},
				},
			},
		},
		nextSwitchID: switchID,
	}
	modelRepo := &switchModelModelRepo{
		model: &db.Model{
			ID:            toModelID,
			Provider:      "OpenAI",
			APIKey:        "sk-original",
			BaseURL:       "https://original.example/v1",
			Model:         "gpt-4.1",
			InterfaceType: string(consts.InterfaceTypeOpenAIResponse),
			Edges: db.ModelEdges{
				Apikeys: []*db.ModelApiKey{{APIKey: "sk-other-user"}},
			},
		},
		runtimeKey: "sk-runtime",
	}
	taskMgr := &switchModelTaskManager{
		resp: &taskflow.RestartTaskResp{
			ID:        restartTaskID,
			RequestId: "req-switch",
			Success:   true,
			Message:   "restarted",
			SessionID: "session-1",
		},
	}
	cfg := &config.Config{}
	cfg.LLMProxy.BaseURL = "https://proxy.example"
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	if err := rdb.Set(ctx, consts.PublicModelKey("sk-runtime"), `{"name":"old-model"}`, time.Minute).Err(); err != nil {
		t.Fatalf("seed model cache: %v", err)
	}
	uc := &TaskUsecase{
		cfg:       cfg,
		repo:      repo,
		modelRepo: modelRepo,
		taskflow:  &switchModelTaskflow{taskMgr: taskMgr, vm: &switchModelVM{}},
		logger:    slog.Default(),
		redis:     rdb,
	}

	resp, err := uc.SwitchModel(ctx, &domain.User{ID: userID}, taskID, domain.SwitchTaskModelReq{
		RequestID:   "req-switch",
		ModelID:     toModelID,
		LoadSession: true,
	})
	if err != nil {
		t.Fatalf("SwitchModel() error = %v", err)
	}
	if resp.ID != switchID {
		t.Fatalf("resp.ID = %s, want switch record id %s", resp.ID, switchID)
	}
	if !resp.Success || resp.RequestID != "req-switch" || resp.SessionID != "session-1" {
		t.Fatalf("resp = %+v, want successful taskflow response", resp)
	}
	if resp.Model == nil || resp.Model.ID != toModelID {
		t.Fatalf("resp.Model = %+v, want target model", resp.Model)
	}
	if resp.Model.APIKey != "" {
		t.Fatalf("resp.Model.APIKey = %q, want empty response api key", resp.Model.APIKey)
	}

	if repo.created == nil {
		t.Fatal("CreateModelSwitch was not called")
	}
	if repo.created.ID != switchID {
		t.Fatalf("switch id = %s, want %s", repo.created.ID, switchID)
	}
	if repo.created.FromModelID == nil || *repo.created.FromModelID != fromModelID {
		t.Fatalf("from model = %v, want %s", repo.created.FromModelID, fromModelID)
	}
	if repo.created.ToModelID != toModelID || !repo.created.LoadSession || repo.created.RequestID != "req-switch" {
		t.Fatalf("created switch = %+v, want target/load_session/request_id", repo.created)
	}

	if taskMgr.restartReq.ID != taskID {
		t.Fatalf("restart task id = %s, want %s", taskMgr.restartReq.ID, taskID)
	}
	if taskMgr.restartReq.ExecutionConfig == nil {
		t.Fatal("restart execution_config is nil")
	}
	envs := taskMgr.restartReq.ExecutionConfig.Envs
	if envs["OPENAI_API_KEY"] != "sk-runtime" || envs["OPEN_CODE_API_KEY"] != "sk-runtime" {
		t.Fatalf("runtime api key envs = %v, want sk-runtime", envs)
	}
	if envs["OPENCODE_DISABLE_DEFAULT_PLUGINS"] != "1" || envs["OPENCODE_DISABLE_LSP_DOWNLOAD"] != "true" {
		t.Fatalf("opencode disable envs = %v", envs)
	}
	if envs["MCAI_MODEL_PROVIDER_TYPE"] != string(consts.InterfaceTypeOpenAIResponse) {
		t.Fatalf("provider type env = %v", envs["MCAI_MODEL_PROVIDER_TYPE"])
	}
	if len(taskMgr.restartReq.ExecutionConfig.ConfigFiles) == 0 {
		t.Fatal("restart config files is empty")
	}

	if repo.finishedID != switchID || !repo.finishedSuccess || repo.finishedMessage != "restarted" || repo.finishedSessionID != "session-1" {
		t.Fatalf("finished = id:%s success:%v message:%q session:%q", repo.finishedID, repo.finishedSuccess, repo.finishedMessage, repo.finishedSessionID)
	}
	if repo.updatedTaskID != taskID || repo.updatedModelID != toModelID {
		t.Fatalf("updated model = task:%s model:%s, want task:%s model:%s", repo.updatedTaskID, repo.updatedModelID, taskID, toModelID)
	}
	if modelRepo.runtimeUserID != userID || modelRepo.runtimeModelID != toModelID || modelRepo.runtimeVMID != "vm-1" {
		t.Fatalf("runtime key args = user:%s model:%s vm:%q", modelRepo.runtimeUserID, modelRepo.runtimeModelID, modelRepo.runtimeVMID)
	}
	if mr.Exists(consts.PublicModelKey("sk-runtime")) {
		t.Fatal("model cache still exists, want invalidated runtime token cache")
	}
}

func TestSwitchModelReturnsSuccessWhenPersistenceFailsAfterRestart(t *testing.T) {
	ctx := context.Background()
	userID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	taskID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	toModelID := uuid.MustParse("55555555-5555-5555-5555-555555555555")

	repo := newSwitchModelTaskRepo(userID, taskID, uuid.New(), consts.TaskStatusProcessing)
	repo.completeErr = errors.New("project task update failed")
	modelRepo := &switchModelModelRepo{
		model: &db.Model{
			ID:            toModelID,
			Provider:      "OpenAI",
			APIKey:        "sk-original",
			BaseURL:       "https://original.example/v1",
			Model:         "gpt-4.1",
			InterfaceType: string(consts.InterfaceTypeOpenAIResponse),
		},
		runtimeKey: "sk-runtime",
	}
	taskMgr := &switchModelTaskManager{
		resp: &taskflow.RestartTaskResp{
			RequestId: "req-switch",
			Success:   true,
			Message:   "restarted",
			SessionID: "session-1",
		},
	}
	cfg := &config.Config{}
	cfg.LLMProxy.BaseURL = "https://proxy.example"
	uc := &TaskUsecase{
		cfg:       cfg,
		repo:      repo,
		modelRepo: modelRepo,
		taskflow:  &switchModelTaskflow{taskMgr: taskMgr, vm: &switchModelVM{}},
		logger:    slog.Default(),
	}

	resp, err := uc.SwitchModel(ctx, &domain.User{ID: userID}, taskID, domain.SwitchTaskModelReq{
		RequestID: "req-switch",
		ModelID:   toModelID,
	})
	if err != nil {
		t.Fatalf("SwitchModel() error = %v, want nil after taskflow success", err)
	}
	if resp == nil || !resp.Success {
		t.Fatalf("resp = %+v, want taskflow success preserved", resp)
	}
	if !strings.Contains(resp.Message, "persist") {
		t.Fatalf("resp.Message = %q, want persistence warning", resp.Message)
	}
}

func TestSwitchModelRejectsTaskThatIsNotProcessing(t *testing.T) {
	ctx := context.Background()
	userID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	taskID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	toModelID := uuid.MustParse("55555555-5555-5555-5555-555555555555")

	repo := newSwitchModelTaskRepo(userID, taskID, uuid.New(), consts.TaskStatusPending)
	uc := &TaskUsecase{
		repo:      repo,
		modelRepo: &switchModelModelRepo{},
		taskflow:  &switchModelTaskflow{taskMgr: &switchModelTaskManager{}, vm: &switchModelVM{}},
		logger:    slog.Default(),
	}

	_, err := uc.SwitchModel(ctx, &domain.User{ID: userID}, taskID, domain.SwitchTaskModelReq{ModelID: toModelID})
	if err == nil {
		t.Fatal("SwitchModel() error is nil, want non-processing task rejected")
	}
}

func newSwitchModelTaskRepo(userID, taskID, fromModelID uuid.UUID, status consts.TaskStatus) *switchModelTaskRepo {
	return &switchModelTaskRepo{
		task: &db.Task{
			ID:           taskID,
			UserID:       userID,
			Status:       status,
			CreatedAt:    time.Now(),
			LastActiveAt: time.Now(),
			Edges: db.TaskEdges{
				Vms: []*db.VirtualMachine{
					{ID: "vm-1", CreatedAt: time.Now()},
				},
				ProjectTasks: []*db.ProjectTask{
					{
						TaskID:  taskID,
						ModelID: fromModelID,
						CliName: consts.CliNameOpencode,
						Edges: db.ProjectTaskEdges{
							Model: &db.Model{ID: fromModelID},
						},
					},
				},
			},
		},
		nextSwitchID: uuid.New(),
	}
}

type switchModelTaskRepo struct {
	task              *db.Task
	nextSwitchID      uuid.UUID
	created           *domain.TaskModelSwitch
	finishedID        uuid.UUID
	finishedSuccess   bool
	finishedMessage   string
	finishedSessionID string
	updatedTaskID     uuid.UUID
	updatedModelID    uuid.UUID
	completeErr       error
}

func (r *switchModelTaskRepo) GetByID(context.Context, uuid.UUID) (*db.Task, error) {
	return nil, errors.New("unused")
}
func (r *switchModelTaskRepo) Stat(context.Context, uuid.UUID) (*domain.TaskStats, error) {
	return nil, nil
}
func (r *switchModelTaskRepo) StatByIDs(context.Context, []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	return nil, errors.New("unused")
}
func (r *switchModelTaskRepo) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	return r.task, nil
}
func (r *switchModelTaskRepo) List(context.Context, *domain.User, domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	return nil, nil, errors.New("unused")
}
func (r *switchModelTaskRepo) Create(context.Context, *domain.User, domain.CreateTaskReq, string, func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	return nil, errors.New("unused")
}
func (r *switchModelTaskRepo) Update(context.Context, *domain.User, uuid.UUID, func(*db.TaskUpdateOne) error) error {
	return errors.New("unused")
}
func (r *switchModelTaskRepo) RefreshLastActiveAt(context.Context, uuid.UUID, time.Time, time.Duration) error {
	return errors.New("unused")
}
func (r *switchModelTaskRepo) Stop(context.Context, *domain.User, uuid.UUID, func(*db.Task) error) error {
	return errors.New("unused")
}
func (r *switchModelTaskRepo) Delete(context.Context, *domain.User, uuid.UUID) error {
	return errors.New("unused")
}
func (r *switchModelTaskRepo) UpdateProjectTaskModel(_ context.Context, taskID, modelID uuid.UUID) error {
	r.updatedTaskID = taskID
	r.updatedModelID = modelID
	return nil
}
func (r *switchModelTaskRepo) CreateModelSwitch(_ context.Context, item *domain.TaskModelSwitch) error {
	item.ID = r.nextSwitchID
	copied := *item
	r.created = &copied
	return nil
}
func (r *switchModelTaskRepo) FinishModelSwitch(_ context.Context, id uuid.UUID, success bool, message, sessionID string) error {
	r.finishedID = id
	r.finishedSuccess = success
	r.finishedMessage = message
	r.finishedSessionID = sessionID
	return nil
}
func (r *switchModelTaskRepo) CompleteModelSwitch(_ context.Context, id, taskID, modelID uuid.UUID, success bool, message, sessionID string) error {
	if r.completeErr != nil {
		return r.completeErr
	}
	r.finishedID = id
	r.finishedSuccess = success
	r.finishedMessage = message
	r.finishedSessionID = sessionID
	if success {
		r.updatedTaskID = taskID
		r.updatedModelID = modelID
	}
	return nil
}

type switchModelModelRepo struct {
	model          *db.Model
	runtimeKey     string
	runtimeUserID  uuid.UUID
	runtimeModelID uuid.UUID
	runtimeVMID    string
}

func (r *switchModelModelRepo) Get(context.Context, uuid.UUID, uuid.UUID) (*db.Model, error) {
	return r.model, nil
}
func (r *switchModelModelRepo) List(context.Context, uuid.UUID, domain.CursorReq) ([]*db.Model, *db.Cursor, error) {
	return nil, nil, errors.New("unused")
}
func (r *switchModelModelRepo) Create(context.Context, uuid.UUID, *domain.CreateModelReq) (*db.Model, error) {
	return nil, errors.New("unused")
}
func (r *switchModelModelRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	return errors.New("unused")
}
func (r *switchModelModelRepo) Update(context.Context, uuid.UUID, uuid.UUID, *domain.UpdateModelReq) error {
	return errors.New("unused")
}
func (r *switchModelModelRepo) UpdateCheckResult(context.Context, uuid.UUID, bool, string) error {
	return errors.New("unused")
}
func (r *switchModelModelRepo) CreateRuntimeAPIKey(_ context.Context, uid, modelID uuid.UUID, vmID string) (string, error) {
	r.runtimeUserID = uid
	r.runtimeModelID = modelID
	r.runtimeVMID = vmID
	return r.runtimeKey, nil
}

type switchModelTaskflow struct {
	taskMgr taskflow.TaskManager
	vm      taskflow.VirtualMachiner
}

func (c *switchModelTaskflow) VirtualMachiner() taskflow.VirtualMachiner { return c.vm }
func (c *switchModelTaskflow) Host() taskflow.Hoster                     { return nil }
func (c *switchModelTaskflow) FileManager() taskflow.FileManager         { return nil }
func (c *switchModelTaskflow) TaskManager() taskflow.TaskManager         { return c.taskMgr }
func (c *switchModelTaskflow) PortForwarder() taskflow.PortForwarder     { return nil }
func (c *switchModelTaskflow) Stats(context.Context) (*taskflow.Stats, error) {
	return nil, errors.New("unused")
}
func (c *switchModelTaskflow) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return errors.New("unused")
}

type switchModelVM struct{}

func (v *switchModelVM) Create(context.Context, *taskflow.CreateVirtualMachineReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) Delete(context.Context, *taskflow.DeleteVirtualMachineReq) error {
	return errors.New("unused")
}
func (v *switchModelVM) Hibernate(context.Context, *taskflow.HibernateVirtualMachineReq) error {
	return errors.New("unused")
}
func (v *switchModelVM) Resume(context.Context, *taskflow.ResumeVirtualMachineReq) error {
	return errors.New("unused")
}
func (v *switchModelVM) List(context.Context, string) ([]*taskflow.VirtualMachine, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) Info(context.Context, taskflow.VirtualMachineInfoReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) Terminal(context.Context, *taskflow.TerminalReq) (taskflow.Sheller, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) Reports(context.Context, taskflow.ReportSubscribeReq) (taskflow.Reporter, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) TerminalList(context.Context, string) ([]*taskflow.Terminal, error) {
	return nil, errors.New("unused")
}
func (v *switchModelVM) CloseTerminal(context.Context, *taskflow.CloseTerminalReq) error {
	return errors.New("unused")
}
func (v *switchModelVM) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	return &taskflow.IsOnlineResp{OnlineMap: map[string]bool{"vm-1": true}}, nil
}

type switchModelTaskManager struct {
	resp       *taskflow.RestartTaskResp
	restartReq taskflow.RestartTaskReq
}

func (m *switchModelTaskManager) Create(context.Context, taskflow.CreateTaskReq) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) Stop(context.Context, taskflow.TaskReq) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) Restart(_ context.Context, req taskflow.RestartTaskReq) (*taskflow.RestartTaskResp, error) {
	m.restartReq = req
	return m.resp, nil
}
func (m *switchModelTaskManager) Cancel(context.Context, taskflow.TaskReq) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) Continue(context.Context, taskflow.TaskReq) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) AutoApprove(context.Context, taskflow.TaskApproveReq) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) AskUserQuestion(context.Context, taskflow.AskUserQuestionResponse) error {
	return errors.New("unused")
}
func (m *switchModelTaskManager) ListFiles(context.Context, taskflow.RepoListFilesReq) (*taskflow.RepoListFiles, error) {
	return nil, errors.New("unused")
}
func (m *switchModelTaskManager) ReadFile(context.Context, taskflow.RepoReadFileReq) (*taskflow.RepoReadFile, error) {
	return nil, errors.New("unused")
}
func (m *switchModelTaskManager) FileDiff(context.Context, taskflow.RepoFileDiffReq) (*taskflow.RepoFileDiff, error) {
	return nil, errors.New("unused")
}
func (m *switchModelTaskManager) FileChanges(context.Context, taskflow.RepoFileChangesReq) (*taskflow.RepoFileChanges, error) {
	return nil, errors.New("unused")
}
