package usecase

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

func TestResetPasswordReturnsGeneratedPasswordAndUpdatesTeamMember(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &resetPasswordRepoStub{
		member: &db.TeamMember{
			TeamID: teamID,
			UserID: userID,
			Edges: db.TeamMemberEdges{
				User: &db.User{
					ID:    userID,
					Email: "member@example.com",
				},
			},
		},
	}
	u := &TeamGroupUserUsecase{
		repo:   repo,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	resp, err := u.ResetPassword(ctx, &domain.TeamUser{Team: &domain.Team{ID: teamID}}, &domain.ResetPasswordReq{UserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Email != "member@example.com" {
		t.Fatalf("email = %q, want member@example.com", resp.Email)
	}
	if len(resp.Password) != 16 {
		t.Fatalf("password length = %d, want 16", len(resp.Password))
	}
	if repo.resetUserID != userID {
		t.Fatalf("reset user id = %s, want %s", repo.resetUserID, userID)
	}
	if repo.resetPassword != resp.Password {
		t.Fatal("response password should match stored password input")
	}
}

func TestResetPasswordRejectsUserOutsideTeam(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &resetPasswordRepoStub{getMemberErr: errcode.ErrNotFound}
	u := &TeamGroupUserUsecase{
		repo:   repo,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	_, err := u.ResetPassword(ctx, &domain.TeamUser{Team: &domain.Team{ID: teamID}}, &domain.ResetPasswordReq{UserID: userID})
	if err == nil {
		t.Fatal("expected error")
	}
	if repo.resetCalled {
		t.Fatal("password should not be reset when user is outside team")
	}
}

func TestDeleteUserRejectsUserOutsideTeam(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &resetPasswordRepoStub{getMemberErr: errcode.ErrNotFound}
	u := &TeamGroupUserUsecase{
		repo:   repo,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	err := u.DeleteUser(ctx, &domain.TeamUser{Team: &domain.Team{ID: teamID}}, &domain.DeleteTeamUserReq{UserID: userID})
	if err == nil {
		t.Fatal("expected error")
	}
	if repo.deleteCalled {
		t.Fatal("user should not be deleted when outside team")
	}
}

func TestUpdateUserAllowsNameOnly(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	repo := &resetPasswordRepoStub{
		updatedUser: &db.User{
			ID:    userID,
			Name:  "new name",
			Email: "member@example.com",
		},
	}
	u := &TeamGroupUserUsecase{
		repo:   repo,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	resp, err := u.UpdateUser(ctx, &domain.UpdateTeamUserReq{
		UserID: userID,
		Name:   stringPtr("new name"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.User.Name != "new name" {
		t.Fatalf("name = %q, want new name", resp.User.Name)
	}
}

type resetPasswordRepoStub struct {
	domain.TeamGroupUserRepo
	member        *db.TeamMember
	getMemberErr  error
	resetCalled   bool
	resetUserID   uuid.UUID
	resetPassword string
	deleteCalled  bool
	deletedUserID uuid.UUID
	updatedUser   *db.User
}

func (s *resetPasswordRepoStub) GetMember(ctx context.Context, teamID, userID uuid.UUID) (*db.TeamMember, error) {
	if s.getMemberErr != nil {
		return nil, s.getMemberErr
	}
	return s.member, nil
}

func (s *resetPasswordRepoStub) ResetPassword(ctx context.Context, userID uuid.UUID, newPassword string) error {
	s.resetCalled = true
	s.resetUserID = userID
	s.resetPassword = newPassword
	return nil
}

func (s *resetPasswordRepoStub) DeleteUser(ctx context.Context, teamID, userID uuid.UUID) error {
	s.deleteCalled = true
	s.deletedUserID = userID
	return nil
}

func (s *resetPasswordRepoStub) UpdateUser(ctx context.Context, userID uuid.UUID, req *domain.UpdateTeamUserReq) (*db.User, error) {
	return s.updatedUser, nil
}

func stringPtr(value string) *string {
	return &value
}
