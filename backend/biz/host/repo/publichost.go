package repo

import (
	"context"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type PublicHostRepo struct {
	db *db.Client
}

func NewPublicHostRepo(i *do.Injector) (domain.PublicHostRepo, error) {
	return &PublicHostRepo{
		db: do.MustInvoke[*db.Client](i),
	}, nil
}

// All implements domain.PublicHostRepo.
func (p *PublicHostRepo) All(ctx context.Context) ([]*db.Host, error) {
	us, err := p.db.User.Query().
		WithHosts().
		Where(user.Role(consts.UserRoleAdmin)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	hs := make([]*db.Host, 0)
	for _, u := range us {
		for _, h := range u.Edges.Hosts {
			hs = append(hs, h)
		}
	}
	return hs, nil
}
