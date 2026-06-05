package repo

import (
	"context"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type TeamPolicyRepo struct {
	db *db.Client
}

func NewTeamPolicyRepo(i *do.Injector) (domain.TeamPolicyRepo, error) {
	return &TeamPolicyRepo{db: do.MustInvoke[*db.Client](i)}, nil
}

func (r *TeamPolicyRepo) GetTeam(ctx context.Context, teamID uuid.UUID) (*db.Team, error) {
	return r.db.Team.Get(ctx, teamID)
}

func (r *TeamPolicyRepo) GetTeamByUserID(ctx context.Context, userID uuid.UUID) (*db.Team, error) {
	return r.db.Team.Query().
		Where(team.HasTeamMembersWith(teammember.UserIDEQ(userID))).
		Order(team.ByCreatedAt(sql.OrderAsc())).
		First(ctx)
}

func (r *TeamPolicyRepo) UpdateTaskVMIdlePolicy(ctx context.Context, teamID uuid.UUID, req *domain.UpdateTeamTaskVMIdlePolicyReq) (*db.Team, error) {
	return r.db.Team.UpdateOneID(teamID).
		SetTaskVMSleepEnabled(req.SleepEnabled).
		SetTaskVMSleepSeconds(req.SleepSeconds).
		SetTaskVMRecycleEnabled(req.RecycleEnabled).
		SetTaskVMRecycleSeconds(req.RecycleSeconds).
		Save(ctx)
}

func (r *TeamPolicyRepo) GetMember(ctx context.Context, teamID, userID uuid.UUID) (*db.TeamMember, error) {
	return r.db.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamID), teammember.UserIDEQ(userID)).
		WithUser().
		First(ctx)
}
