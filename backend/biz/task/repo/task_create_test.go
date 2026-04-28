package repo

import (
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskRepoCreateCreatesModelApiKeyWithoutPricing(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:task-repo-create-model-apikey?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	modelID := uuid.New()
	imageID := uuid.New()
	hostID := "host-task-create"
	vmID := "vm-task-create"

	if _, err := client.User.Create().SetID(userID).SetName("user").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := client.Host.Create().SetID(hostID).SetUserID(userID).Save(ctx); err != nil {
		t.Fatalf("create host: %v", err)
	}
	if _, err := client.Model.Create().SetID(modelID).SetUserID(userID).SetProvider("OpenAI").SetAPIKey("secret").SetBaseURL("https://api.example.com").SetModel("gpt-4o").Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}
	if _, err := client.Image.Create().SetID(imageID).SetUserID(userID).SetName("image").Save(ctx); err != nil {
		t.Fatalf("create image: %v", err)
	}

	repo := &TaskRepo{
		cfg:    &config.Config{},
		db:     client,
		logger: slog.Default(),
	}
	req := domain.CreateTaskReq{
		Content: "content",
		HostID:  hostID,
		ImageID: imageID,
		ModelID: modelID.String(),
		Resource: &domain.VMResource{
			Core:   1,
			Memory: 1024,
		},
		Type: consts.TaskTypeDevelop,
		Now:  time.Now(),
	}

	_, err := repo.Create(ctx, &domain.User{ID: userID}, req, "", func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error) {
		return &taskflow.VirtualMachine{ID: vmID, EnvironmentID: "env-task-create"}, nil
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	keys, err := client.ModelApiKey.Query().Where(modelapikey.ModelID(modelID), modelapikey.UserID(userID)).All(ctx)
	if err != nil {
		t.Fatalf("query model api keys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("model api key count = %d, want 1", len(keys))
	}
	if keys[0].VirtualmachineID != vmID {
		t.Fatalf("virtualmachine id = %q, want %q", keys[0].VirtualmachineID, vmID)
	}
}

func TestTaskRepoCompleteModelSwitchUpdatesHistoryAndCurrentModel(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:task-repo-complete-model-switch?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	taskID := uuid.New()
	fromModelID := uuid.New()
	toModelID := uuid.New()
	imageID := uuid.New()
	switchID := uuid.New()

	if _, err := client.User.Create().SetID(userID).SetName("user").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
	for _, id := range []uuid.UUID{fromModelID, toModelID} {
		if _, err := client.Model.Create().SetID(id).SetUserID(userID).SetProvider("OpenAI").SetAPIKey("secret").SetBaseURL("https://api.example.com").SetModel("gpt-4o").Save(ctx); err != nil {
			t.Fatalf("create model: %v", err)
		}
	}
	if _, err := client.Image.Create().SetID(imageID).SetUserID(userID).SetName("image").Save(ctx); err != nil {
		t.Fatalf("create image: %v", err)
	}
	if _, err := client.Task.Create().SetID(taskID).SetUserID(userID).SetKind(consts.TaskTypeDevelop).SetContent("content").SetStatus(consts.TaskStatusProcessing).Save(ctx); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := client.ProjectTask.Create().SetID(uuid.New()).SetTaskID(taskID).SetModelID(fromModelID).SetImageID(imageID).SetCliName(consts.CliNameOpencode).Save(ctx); err != nil {
		t.Fatalf("create project task: %v", err)
	}
	if _, err := client.TaskModelSwitch.Create().SetID(switchID).SetTaskID(taskID).SetUserID(userID).SetToModelID(toModelID).Save(ctx); err != nil {
		t.Fatalf("create switch: %v", err)
	}

	repo := &TaskRepo{db: client, logger: slog.Default()}
	if err := repo.CompleteModelSwitch(ctx, switchID, taskID, toModelID, true, "restarted", "session-1"); err != nil {
		t.Fatalf("CompleteModelSwitch() error = %v", err)
	}

	pt, err := client.ProjectTask.Query().Only(ctx)
	if err != nil {
		t.Fatalf("query project task: %v", err)
	}
	if pt.ModelID != toModelID {
		t.Fatalf("project task model = %s, want %s", pt.ModelID, toModelID)
	}
	sw, err := client.TaskModelSwitch.Get(ctx, switchID)
	if err != nil {
		t.Fatalf("query switch: %v", err)
	}
	if sw.Success == nil || !*sw.Success || sw.Message != "restarted" || sw.SessionID != "session-1" {
		t.Fatalf("switch = %+v, want completed success", sw)
	}
}

func TestTaskRepoUpdateProjectTaskModelRequiresOneRow(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:task-repo-update-model-count?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	repo := &TaskRepo{db: client, logger: slog.Default()}
	err := repo.UpdateProjectTaskModel(ctx, uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("UpdateProjectTaskModel() error is nil")
	}
	if !strings.Contains(err.Error(), "want 1") {
		t.Fatalf("UpdateProjectTaskModel() error = %q, want count error", err.Error())
	}
}
