package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestResolveTaskConcurrencyLimitPrefersTeamPolicy(t *testing.T) {
	userID := uuid.New()
	u := &TaskUsecase{
		teamPolicyRepo: &taskConcurrencyTeamPolicyRepoStub{
			team: &db.Team{ID: uuid.New(), TaskConcurrencyLimit: 7},
		},
		taskHook: taskConcurrencyHookStub{limit: 3},
	}

	got, err := u.resolveTaskConcurrencyLimit(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 7 {
		t.Fatalf("limit = %d, want 7", got)
	}
}

func TestResolveTaskConcurrencyLimitFallsBackWhenTeamNotFound(t *testing.T) {
	userID := uuid.New()
	u := &TaskUsecase{
		teamPolicyRepo: &taskConcurrencyTeamPolicyRepoStub{err: &db.NotFoundError{}},
		taskHook:       taskConcurrencyHookStub{limit: 4},
	}

	got, err := u.resolveTaskConcurrencyLimit(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 4 {
		t.Fatalf("limit = %d, want 4", got)
	}
}

func TestResolveTaskConcurrencyLimitReturnsTeamRepoError(t *testing.T) {
	userID := uuid.New()
	wantErr := errors.New("database down")
	u := &TaskUsecase{
		teamPolicyRepo: &taskConcurrencyTeamPolicyRepoStub{err: wantErr},
		taskHook:       taskConcurrencyHookStub{limit: 4},
	}

	_, err := u.resolveTaskConcurrencyLimit(context.Background(), userID)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
}

func TestResolveTaskConcurrencyLimitDefaultsWhenNoPolicyOrHookLimit(t *testing.T) {
	got, err := (&TaskUsecase{}).resolveTaskConcurrencyLimit(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if got != 3 {
		t.Fatalf("limit = %d, want 3", got)
	}
}

type taskConcurrencyTeamPolicyRepoStub struct {
	team *db.Team
	err  error
}

func (s *taskConcurrencyTeamPolicyRepoStub) GetTeam(context.Context, uuid.UUID) (*db.Team, error) {
	return nil, nil
}

func (s *taskConcurrencyTeamPolicyRepoStub) GetTeamByUserID(context.Context, uuid.UUID) (*db.Team, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.team, nil
}

func (s *taskConcurrencyTeamPolicyRepoStub) UpdateTaskVMIdlePolicy(context.Context, uuid.UUID, *domain.UpdateTeamTaskVMIdlePolicyReq) (*db.Team, error) {
	return nil, nil
}

func (s *taskConcurrencyTeamPolicyRepoStub) GetMember(context.Context, uuid.UUID, uuid.UUID) (*db.TeamMember, error) {
	return nil, nil
}

type taskConcurrencyHookStub struct {
	limit int
}

func (s taskConcurrencyHookStub) GetSystemPrompt(context.Context, consts.TaskType, consts.TaskSubType) (string, error) {
	return "", nil
}

func (s taskConcurrencyHookStub) OnTaskCreated(context.Context, *domain.ProjectTask) error {
	return nil
}

func (s taskConcurrencyHookStub) GitTask(context.Context, uuid.UUID) (*domain.GitTask, error) {
	return nil, nil
}

func (s taskConcurrencyHookStub) GetMaxConcurrent(context.Context, uuid.UUID) (int, error) {
	return s.limit, nil
}
