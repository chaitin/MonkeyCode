package domain_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestModelFromPreservesCredentialsForPureConversion(t *testing.T) {
	modelID := uuid.New()
	src := &db.Model{
		ID:        modelID,
		Provider:  "OpenAI",
		APIKey:    "sk-admin-secret",
		BaseURL:   "https://api.example.com/v1",
		Model:     "gpt-4o",
		CreatedAt: time.Unix(100, 0),
		UpdatedAt: time.Unix(200, 0),
		Edges: db.ModelEdges{
			User: &db.User{
				ID:   uuid.New(),
				Role: consts.UserRoleAdmin,
				Name: "admin",
			},
		},
	}

	got := (&domain.Model{}).From(src)

	if got.APIKey != src.APIKey {
		t.Fatalf("APIKey = %q, want %q", got.APIKey, src.APIKey)
	}
	if got.BaseURL != src.BaseURL {
		t.Fatalf("BaseURL = %q, want %q", got.BaseURL, src.BaseURL)
	}
	if got.Owner == nil || got.Owner.Type != consts.OwnerTypePublic {
		t.Fatalf("Owner = %#v, want public owner", got.Owner)
	}
}

func TestProjectTaskFromDoesNotExposeModelCredentials(t *testing.T) {
	pt := (&domain.ProjectTask{}).From(&db.ProjectTask{
		Branch: "main",
		Edges: db.ProjectTaskEdges{
			Model: privateModelWithCredentials(),
			Task: &db.Task{
				ID:        uuid.New(),
				UserID:    uuid.New(),
				CreatedAt: time.Unix(100, 0),
				UpdatedAt: time.Unix(200, 0),
			},
		},
	})

	payload, err := json.Marshal(pt)
	if err != nil {
		t.Fatalf("marshal project task: %v", err)
	}

	assertNoModelCredentials(t, string(payload))
}

func TestTaskFromDoesNotExposeModelCredentials(t *testing.T) {
	task := (&domain.Task{}).From(&db.Task{
		ID:        uuid.New(),
		UserID:    uuid.New(),
		CreatedAt: time.Unix(100, 0),
		UpdatedAt: time.Unix(200, 0),
		Edges: db.TaskEdges{
			ProjectTasks: []*db.ProjectTask{
				{
					Edges: db.ProjectTaskEdges{
						Model: privateModelWithCredentials(),
					},
				},
			},
		},
	})

	payload, err := json.Marshal(task)
	if err != nil {
		t.Fatalf("marshal task: %v", err)
	}

	assertNoModelCredentials(t, string(payload))
}

func privateModelWithCredentials() *db.Model {
	return &db.Model{
		ID:        uuid.New(),
		Provider:  "OpenAI",
		APIKey:    "sk-private-secret",
		BaseURL:   "https://private.example.com/v1",
		Model:     "gpt-4o",
		CreatedAt: time.Unix(100, 0),
		UpdatedAt: time.Unix(200, 0),
		Edges: db.ModelEdges{
			User: &db.User{
				ID:   uuid.New(),
				Role: consts.UserRoleIndividual,
				Name: "user",
			},
		},
	}
}

func assertNoModelCredentials(t *testing.T, payload string) {
	t.Helper()

	for _, forbidden := range []string{"api_key", "sk-private-secret", "https://private.example.com/v1"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("payload exposes %q: %s", forbidden, payload)
		}
	}
}
