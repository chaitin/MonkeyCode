package repo

import (
	"context"
	"log/slog"
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
