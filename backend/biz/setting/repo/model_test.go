package repo

import (
	"context"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
)

func TestModelRepoGetDoesNotLoadRuntimeApikeys(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-repo-get-apikeys?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	modelID := uuid.New()
	keyID := uuid.New()

	if _, err := client.User.Create().
		SetID(userID).
		SetName("user").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(userID).
		SetProvider("OpenAI").
		SetAPIKey("model-key").
		SetBaseURL("https://model.example/v1").
		SetModel("gpt-4.1").
		Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}
	if _, err := client.ModelApiKey.Create().
		SetID(keyID).
		SetUserID(userID).
		SetModelID(modelID).
		SetAPIKey("runtime-key").
		Save(ctx); err != nil {
		t.Fatalf("create model api key: %v", err)
	}

	repo := &modelRepo{db: client}
	got, err := repo.Get(ctx, userID, modelID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(got.Edges.Apikeys) != 0 {
		t.Fatalf("apikey count = %d, want 0", len(got.Edges.Apikeys))
	}
	if got.Edges.User == nil {
		t.Fatal("user edge is nil, want existing WithUser behavior preserved")
	}
}

func TestModelRepoCreateRuntimeAPIKeyScopesUserModelAndVM(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-repo-create-runtime-key?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	otherUserID := uuid.New()
	modelID := uuid.New()
	vmID := "vm-runtime"

	for _, u := range []uuid.UUID{userID, otherUserID} {
		if _, err := client.User.Create().
			SetID(u).
			SetName("user").
			SetRole(consts.UserRoleIndividual).
			SetStatus(consts.UserStatusActive).
			Save(ctx); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(userID).
		SetProvider("OpenAI").
		SetAPIKey("model-key").
		SetBaseURL("https://model.example/v1").
		SetModel("gpt-4.1").
		Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}

	repo := &modelRepo{db: client}
	key, err := repo.CreateRuntimeAPIKey(ctx, userID, modelID, vmID)
	if err != nil {
		t.Fatalf("CreateRuntimeAPIKey() error = %v", err)
	}
	if key == "" || key == "model-key" {
		t.Fatalf("runtime key = %q, want generated token", key)
	}

	keys, err := client.ModelApiKey.Query().All(ctx)
	if err != nil {
		t.Fatalf("query keys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("key count = %d, want 1", len(keys))
	}
	if keys[0].UserID != userID || keys[0].ModelID != modelID || keys[0].VirtualmachineID != vmID || keys[0].APIKey != key {
		t.Fatalf("key = %+v, want scoped runtime key", keys[0])
	}
}

func TestModelRepoGetAllowsAdminBuiltinModel(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-repo-get-admin-builtin?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	adminID := uuid.New()
	modelID := uuid.New()

	createModelTestUser(t, ctx, client, userID, consts.UserRoleIndividual)
	createModelTestUser(t, ctx, client, adminID, consts.UserRoleAdmin)
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(adminID).
		SetProvider("OpenAI").
		SetAPIKey("model-key").
		SetBaseURL("https://model.example/v1").
		SetModel("gpt-4.1").
		Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}

	repo := &modelRepo{db: client}
	got, err := repo.Get(ctx, userID, modelID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got.ID != modelID || got.UserID != adminID {
		t.Fatalf("model = %+v, want admin builtin model", got)
	}
}

func TestModelRepoCreateRuntimeAPIKeyAllowsAdminBuiltinModel(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-repo-runtime-key-admin-builtin?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	adminID := uuid.New()
	modelID := uuid.New()
	vmID := "vm-builtin"

	createModelTestUser(t, ctx, client, userID, consts.UserRoleIndividual)
	createModelTestUser(t, ctx, client, adminID, consts.UserRoleAdmin)
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(adminID).
		SetProvider("OpenAI").
		SetAPIKey("model-key").
		SetBaseURL("https://model.example/v1").
		SetModel("gpt-4.1").
		Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}

	repo := &modelRepo{db: client}
	key, err := repo.CreateRuntimeAPIKey(ctx, userID, modelID, vmID)
	if err != nil {
		t.Fatalf("CreateRuntimeAPIKey() error = %v", err)
	}

	keys, err := client.ModelApiKey.Query().All(ctx)
	if err != nil {
		t.Fatalf("query keys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("key count = %d, want 1", len(keys))
	}
	if keys[0].UserID != userID || keys[0].ModelID != modelID || keys[0].VirtualmachineID != vmID || keys[0].APIKey != key {
		t.Fatalf("key = %+v, want runtime key for requesting user and builtin model", keys[0])
	}
}

func TestModelRepoCreateRuntimeAPIKeyReusesVMRuntimeKey(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-repo-reuse-runtime-key?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	adminID := uuid.New()
	oldModelID := uuid.New()
	targetModelID := uuid.New()
	keyID := uuid.New()
	vmID := "vm-reuse-runtime"
	runtimeKey := "existing-runtime-key"

	createModelTestUser(t, ctx, client, userID, consts.UserRoleIndividual)
	createModelTestUser(t, ctx, client, adminID, consts.UserRoleAdmin)
	if _, err := client.Model.Create().
		SetID(oldModelID).
		SetUserID(userID).
		SetProvider("OpenAI").
		SetAPIKey("old-model-key").
		SetBaseURL("https://old.example/v1").
		SetModel("gpt-4.1").
		Save(ctx); err != nil {
		t.Fatalf("create old model: %v", err)
	}
	if _, err := client.Model.Create().
		SetID(targetModelID).
		SetUserID(adminID).
		SetProvider("OpenAI").
		SetAPIKey("target-model-key").
		SetBaseURL("https://target.example/v1").
		SetModel("gpt-5").
		Save(ctx); err != nil {
		t.Fatalf("create target model: %v", err)
	}
	if _, err := client.ModelApiKey.Create().
		SetID(keyID).
		SetUserID(userID).
		SetModelID(oldModelID).
		SetVirtualmachineID(vmID).
		SetAPIKey(runtimeKey).
		Save(ctx); err != nil {
		t.Fatalf("create existing runtime key: %v", err)
	}

	repo := &modelRepo{db: client}
	key, err := repo.CreateRuntimeAPIKey(ctx, userID, targetModelID, vmID)
	if err != nil {
		t.Fatalf("CreateRuntimeAPIKey() error = %v", err)
	}
	if key != runtimeKey {
		t.Fatalf("runtime key = %q, want reused %q", key, runtimeKey)
	}

	keys, err := client.ModelApiKey.Query().All(ctx)
	if err != nil {
		t.Fatalf("query keys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("key count = %d, want 1", len(keys))
	}
	got, err := client.ModelApiKey.Query().Where(modelapikey.ID(keyID)).Only(ctx)
	if err != nil {
		t.Fatalf("query reused key: %v", err)
	}
	if got.APIKey != runtimeKey || got.UserID != userID || got.VirtualmachineID != vmID || got.ModelID != targetModelID {
		t.Fatalf("key = %+v, want reused key updated to target model", got)
	}
}

func createModelTestUser(t *testing.T, ctx context.Context, client *db.Client, id uuid.UUID, role consts.UserRole) {
	t.Helper()
	if _, err := client.User.Create().
		SetID(id).
		SetName("user").
		SetRole(role).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
}
