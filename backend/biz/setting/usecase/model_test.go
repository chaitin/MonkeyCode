package usecase

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type stubModelRepo struct {
	models []*db.Model
	page   *db.Cursor
}

func (s *stubModelRepo) Get(context.Context, uuid.UUID, uuid.UUID) (*db.Model, error) {
	panic("unexpected call to Get")
}

func (s *stubModelRepo) List(context.Context, uuid.UUID, domain.CursorReq) ([]*db.Model, *db.Cursor, error) {
	return s.models, s.page, nil
}

func (s *stubModelRepo) Create(context.Context, uuid.UUID, *domain.CreateModelReq) (*db.Model, error) {
	panic("unexpected call to Create")
}

func (s *stubModelRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected call to Delete")
}

func (s *stubModelRepo) Update(context.Context, uuid.UUID, uuid.UUID, *domain.UpdateModelReq) error {
	panic("unexpected call to Update")
}

func (s *stubModelRepo) UpdateCheckResult(context.Context, uuid.UUID, bool, string) error {
	panic("unexpected call to UpdateCheckResult")
}

type stubUserRepo struct {
	user *db.User
}

func (s *stubUserRepo) Get(context.Context, uuid.UUID) (*db.User, error) {
	return s.user, nil
}

func (s *stubUserRepo) Update(context.Context, uuid.UUID, string, string) error {
	panic("unexpected call to Update")
}

func (s *stubUserRepo) GetUserWithTeams(context.Context, uuid.UUID) (*db.User, error) {
	panic("unexpected call to GetUserWithTeams")
}

func (s *stubUserRepo) PasswordLogin(context.Context, *domain.TeamLoginReq) (*db.User, error) {
	panic("unexpected call to PasswordLogin")
}

func (s *stubUserRepo) ChangePassword(context.Context, uuid.UUID, string, string, bool) error {
	panic("unexpected call to ChangePassword")
}

func (s *stubUserRepo) GetUserByEmail(context.Context, []string) ([]*db.User, error) {
	panic("unexpected call to GetUserByEmail")
}

func (s *stubUserRepo) SetEmail(context.Context, uuid.UUID, string) error {
	panic("unexpected call to SetEmail")
}

type stubModelListHook struct {
	models []*domain.Model
	err    error
}

func (s *stubModelListHook) ListPublic(context.Context, uuid.UUID) ([]*domain.Model, error) {
	return s.models, s.err
}

func TestModelUsecaseListWithoutHookKeepsExistingModels(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	modelID := uuid.New()
	u := &modelUsecase{
		repo: &stubModelRepo{
			models: []*db.Model{{
				ID:            modelID,
				Model:         "claude-3-7-sonnet",
				InterfaceType: string(consts.InterfaceTypeOpenAIChat),
			}},
		},
		userRepo: &stubUserRepo{
			user: &db.User{ID: userID},
		},
		logger: slog.New(slog.NewTextHandler(testWriter{t}, nil)),
	}

	resp, err := u.List(context.Background(), userID, domain.CursorReq{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(resp.Models) != 1 {
		t.Fatalf("List() model count = %d, want 1", len(resp.Models))
	}
	if resp.Models[0].ID != modelID {
		t.Fatalf("List() first model id = %s, want %s", resp.Models[0].ID, modelID)
	}
}

func TestModelUsecaseListMergesAdditionalPublicModels(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	privateModelID := uuid.New()
	publicModelID := uuid.New()
	u := &modelUsecase{
		repo: &stubModelRepo{
			models: []*db.Model{{
				ID:            privateModelID,
				Model:         "user-private-model",
				InterfaceType: string(consts.InterfaceTypeOpenAIChat),
			}},
		},
		userRepo: &stubUserRepo{
			user: &db.User{ID: userID},
		},
		logger: slog.New(slog.NewTextHandler(testWriter{t}, nil)),
		modelHook: &stubModelListHook{
			models: []*domain.Model{{
				ID:    publicModelID,
				Model: "deepseek-r1",
				Owner: &domain.Owner{
					ID:   uuid.NewString(),
					Type: consts.OwnerTypePublic,
					Name: consts.MonkeyCodeAITeamName,
				},
				InterfaceType: consts.InterfaceTypeOpenAIChat,
			}},
		},
	}

	resp, err := u.List(context.Background(), userID, domain.CursorReq{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(resp.Models) != 2 {
		t.Fatalf("List() model count = %d, want 2", len(resp.Models))
	}
	if resp.Models[0].ID != publicModelID {
		t.Fatalf("List() first model id = %s, want public model %s", resp.Models[0].ID, publicModelID)
	}
	if resp.Models[1].ID != privateModelID {
		t.Fatalf("List() second model id = %s, want private model %s", resp.Models[1].ID, privateModelID)
	}
}

func TestModelUsecaseListDeduplicatesAdditionalModels(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	sharedID := uuid.New()
	u := &modelUsecase{
		repo: &stubModelRepo{
			models: []*db.Model{{
				ID:            sharedID,
				Model:         "user-private-model",
				InterfaceType: string(consts.InterfaceTypeOpenAIChat),
			}},
		},
		userRepo: &stubUserRepo{
			user: &db.User{ID: userID},
		},
		logger: slog.New(slog.NewTextHandler(testWriter{t}, nil)),
		modelHook: &stubModelListHook{
			models: []*domain.Model{{
				ID:    sharedID,
				Model: "duplicate-public-model",
				Owner: &domain.Owner{
					ID:   uuid.NewString(),
					Type: consts.OwnerTypePublic,
					Name: consts.MonkeyCodeAITeamName,
				},
			}},
		},
	}

	resp, err := u.List(context.Background(), userID, domain.CursorReq{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(resp.Models) != 1 {
		t.Fatalf("List() model count = %d, want 1 after dedupe", len(resp.Models))
	}
	if resp.Models[0].Model != "user-private-model" {
		t.Fatalf("List() kept model = %q, want private model to win", resp.Models[0].Model)
	}
}

func TestModelUsecaseListReturnsHookError(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	wantErr := errors.New("hook failed")
	u := &modelUsecase{
		repo: &stubModelRepo{},
		userRepo: &stubUserRepo{
			user: &db.User{ID: userID},
		},
		logger: slog.New(slog.NewTextHandler(testWriter{t}, nil)),
		modelHook: &stubModelListHook{
			err: wantErr,
		},
	}

	_, err := u.List(context.Background(), userID, domain.CursorReq{})
	if !errors.Is(err, wantErr) {
		t.Fatalf("List() error = %v, want %v", err, wantErr)
	}
}

type testWriter struct {
	t *testing.T
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}
