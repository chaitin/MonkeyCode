package auth

import (
	"context"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func TestResolveRejectsEmptyToken(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:mcphub-auth-empty?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	svc := NewService(client, nil)
	if _, err := svc.Resolve(context.Background(), " "); err != ErrUnauthorized {
		t.Fatalf("Resolve() error = %v, want ErrUnauthorized", err)
	}
}

func TestResolveRejectsUnboundModelKey(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:mcphub-auth-unbound?mode=memory&cache=shared&_fk=1")
	defer client.Close()
	ctx := context.Background()

	userID := uuid.New()
	modelID := uuid.New()
	client.User.Create().
		SetID(userID).
		SetName("u").
		SetEmail("u@example.com").
		SetRole("user").
		SetStatus("active").
		SaveX(ctx)
	client.Model.Create().
		SetID(modelID).
		SetUserID(userID).
		SetProvider("openai").
		SetAPIKey("upstream-key").
		SetBaseURL("https://example.com").
		SetModel("gpt-test").
		SetInterfaceType("openai_chat").
		SaveX(ctx)
	client.ModelApiKey.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetModelID(modelID).
		SetAPIKey("runtime-token").
		SetVirtualmachineID("").
		SaveX(ctx)

	svc := NewService(client, nil)
	if _, err := svc.Resolve(ctx, "runtime-token"); err != ErrTaskNotBound {
		t.Fatalf("Resolve() error = %v, want ErrTaskNotBound", err)
	}
}
