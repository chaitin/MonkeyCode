package usecase

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	teamusecase "github.com/chaitin/MonkeyCode/backend/biz/team/usecase"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type fakeRepo struct {
	skills []*db.Skill
	err    error
}

func (f *fakeRepo) List(_ context.Context, _ uuid.UUID) ([]*db.Skill, error) {
	return f.skills, f.err
}
func (f *fakeRepo) Create(_ context.Context, _, _ uuid.UUID, _ *domain.AddTeamSkillReq) (*db.Skill, error) {
	return nil, nil
}
func (f *fakeRepo) Update(_ context.Context, _ uuid.UUID, _ *domain.UpdateTeamSkillReq) (*db.Skill, error) {
	return nil, nil
}
func (f *fakeRepo) Delete(_ context.Context, _, _ uuid.UUID) error { return nil }

type fakeStore struct {
	presignErr error
	calls      []string
}

func (s *fakeStore) Put(_ context.Context, _ string, _ []byte) (string, string, error) {
	return "", "", nil
}
func (s *fakeStore) PresignGet(_ context.Context, key string, _ time.Duration) (string, error) {
	s.calls = append(s.calls, key)
	if s.presignErr != nil {
		return "", s.presignErr
	}
	return "https://presigned/" + key, nil
}

var _ teamusecase.SkillPackageStore = (*fakeStore)(nil)

func newSkill(name, key string) *db.Skill {
	now := time.Now()
	return &db.Skill{
		ID:               uuid.New(),
		Name:             name,
		Description:      "desc",
		Content:          "SKILL",
		PackageObjectKey: key,
		PackageURL:       "https://oss-direct/" + key,
		SourceType:       "manual",
		SourceLabel:      "manual",
		CreatedAt:        now,
		UpdatedAt:        now,
		Edges:            db.SkillEdges{},
	}
}

func mustUser() *domain.User {
	return &domain.User{ID: uuid.New(), Team: &domain.Team{ID: uuid.New()}}
}

func TestUserSkillUsecase_List_ReplacesPackageURLWithPresigned(t *testing.T) {
	repo := &fakeRepo{skills: []*db.Skill{newSkill("a", "skills/a.zip"), newSkill("b", "skills/b.zip")}}
	store := &fakeStore{}
	uc := &userSkillUsecase{repo: repo, packageStore: store, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	resp, err := uc.List(context.Background(), mustUser())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(resp.Skills) != 2 {
		t.Fatalf("want 2 skills, got %d", len(resp.Skills))
	}
	for i, s := range resp.Skills {
		want := "https://presigned/" + s.PackageKey
		if s.PackageURL != want {
			t.Errorf("skill[%d].PackageURL = %q, want %q", i, s.PackageURL, want)
		}
	}
	if len(store.calls) != 2 {
		t.Errorf("PresignGet called %d times, want 2", len(store.calls))
	}
}

func TestUserSkillUsecase_List_PresignFailureClearsURL(t *testing.T) {
	repo := &fakeRepo{skills: []*db.Skill{newSkill("a", "skills/a.zip")}}
	store := &fakeStore{presignErr: errors.New("boom")}
	uc := &userSkillUsecase{repo: repo, packageStore: store, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	resp, err := uc.List(context.Background(), mustUser())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if resp.Skills[0].PackageURL != "" {
		t.Errorf("PackageURL = %q, want empty on presign failure", resp.Skills[0].PackageURL)
	}
}

func TestUserSkillUsecase_List_EmptyObjectKeySkipsPresign(t *testing.T) {
	repo := &fakeRepo{skills: []*db.Skill{newSkill("a", "")}}
	store := &fakeStore{}
	uc := &userSkillUsecase{repo: repo, packageStore: store, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	resp, err := uc.List(context.Background(), mustUser())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if resp.Skills[0].PackageURL != "" {
		t.Errorf("PackageURL = %q, want empty when object key missing", resp.Skills[0].PackageURL)
	}
	if len(store.calls) != 0 {
		t.Errorf("PresignGet should not be called when object key empty, got %d calls", len(store.calls))
	}
}

func TestUserSkillUsecase_List_NoTeamReturnsUnauthorized(t *testing.T) {
	uc := &userSkillUsecase{repo: &fakeRepo{}, packageStore: &fakeStore{}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	_, err := uc.List(context.Background(), &domain.User{ID: uuid.New()})
	if err == nil {
		t.Fatal("expected error when user has no team")
	}
}
