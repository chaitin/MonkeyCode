package repo

import (
	"context"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/useridentity"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

func NewOAuthLoginRepo(i *do.Injector) (domain.OAuthLoginRepo, error) {
	return &userRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
		redis:  do.MustInvoke[*redis.Client](i),
		config: do.MustInvoke[*config.Config](i),
	}, nil
}

func (u *userRepo) FindUserByOAuthIdentity(ctx context.Context, platform consts.UserPlatform, identityID string) (*db.User, error) {
	identity, err := u.db.UserIdentity.Query().
		Where(useridentity.PlatformEQ(platform), useridentity.IdentityIDEQ(identityID)).
		WithUser().
		First(ctx)
	if err != nil {
		return nil, err
	}
	return identity.Edges.User, nil
}

func (u *userRepo) FindIndividualByEmail(ctx context.Context, email string) (*db.User, error) {
	usr, err := u.db.User.Query().
		Where(
			user.EmailEqualFold(normalizeOAuthEmail(email)),
			user.RoleEQ(consts.UserRoleIndividual),
		).
		First(ctx)
	if db.IsNotFound(err) {
		return nil, nil
	}
	return usr, err
}

func (u *userRepo) CreateIndividualWithIdentity(ctx context.Context, external *domain.OAuthLoginUser) (*db.User, error) {
	var created *db.User
	err := entx.WithTx2(ctx, u.db, func(tx *db.Tx) error {
		usr, err := tx.User.Create().
			SetID(uuid.New()).
			SetName(oauthDisplayName(external)).
			SetEmail(normalizeOAuthEmail(external.Email)).
			SetAvatarURL(external.AvatarURL).
			SetRole(consts.UserRoleIndividual).
			SetStatus(consts.UserStatusActive).
			Save(ctx)
		if err != nil {
			return err
		}
		if err := createOAuthIdentity(ctx, tx.Client(), usr.ID, external); err != nil {
			return err
		}
		created = usr
		return nil
	})
	return created, err
}

func (u *userRepo) BindOAuthIdentity(ctx context.Context, userID uuid.UUID, external *domain.OAuthLoginUser) error {
	return entx.WithTx2(ctx, u.db, func(tx *db.Tx) error {
		exists, err := tx.UserIdentity.Query().
			Where(useridentity.PlatformEQ(external.Provider), useridentity.IdentityIDEQ(external.IdentityID)).
			Exist(ctx)
		if err != nil {
			return err
		}
		if !exists {
			if err := createOAuthIdentity(ctx, tx.Client(), userID, external); err != nil {
				return err
			}
		}
		if external.AvatarURL != "" {
			if _, err := tx.User.Update().
				Where(user.IDEQ(userID), user.Or(user.AvatarURLEQ(""), user.AvatarURLIsNil())).
				SetAvatarURL(external.AvatarURL).
				Save(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

func (u *userRepo) UpdateOAuthIdentity(ctx context.Context, external *domain.OAuthLoginUser) error {
	return entx.WithTx2(ctx, u.db, func(tx *db.Tx) error {
		identity, err := tx.UserIdentity.Query().
			Where(useridentity.PlatformEQ(external.Provider), useridentity.IdentityIDEQ(external.IdentityID)).
			WithUser().
			Only(ctx)
		if err != nil {
			return err
		}
		update := tx.UserIdentity.UpdateOneID(identity.ID).
			SetUsername(oauthDisplayName(external)).
			SetEmail(normalizeOAuthEmail(external.Email))
		if external.AvatarURL != "" {
			update = update.SetAvatarURL(external.AvatarURL)
		}
		if err := update.Exec(ctx); err != nil {
			return err
		}
		if external.AvatarURL == "" || identity.Edges.User == nil {
			return nil
		}
		usr := identity.Edges.User
		if usr.AvatarURL == "" || usr.AvatarURL == identity.AvatarURL {
			return tx.User.UpdateOneID(usr.ID).SetAvatarURL(external.AvatarURL).Exec(ctx)
		}
		return nil
	})
}

func createOAuthIdentity(ctx context.Context, client *db.Client, userID uuid.UUID, external *domain.OAuthLoginUser) error {
	return client.UserIdentity.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetPlatform(external.Provider).
		SetIdentityID(external.IdentityID).
		SetUsername(oauthDisplayName(external)).
		SetEmail(normalizeOAuthEmail(external.Email)).
		SetAvatarURL(external.AvatarURL).
		Exec(ctx)
}

func normalizeOAuthEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func oauthDisplayName(external *domain.OAuthLoginUser) string {
	if external == nil {
		return ""
	}
	for _, value := range []string{external.Name, external.Username, external.Email} {
		if v := strings.TrimSpace(value); v != "" {
			return v
		}
	}
	return external.IdentityID
}
