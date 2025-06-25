package repo

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/admin"
	"github.com/chaitin/MonkeyCode/backend/db/apikey"
	"github.com/chaitin/MonkeyCode/backend/db/invitecode"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type UserRepo struct {
	db *db.Client
}

func NewUserRepo(db *db.Client) domain.UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) InitAdmin(ctx context.Context, username, password string) error {
	_, err := r.AdminByName(ctx, username)
	if db.IsNotFound(err) {
		_, err = r.CreateAdmin(ctx, &db.Admin{
			Username: username,
			Password: password,
			Status:   consts.AdminStatusActive,
		})
	}
	if err != nil {
		return err
	}
	return nil
}

func (r *UserRepo) CreateAdmin(ctx context.Context, admin *db.Admin) (*db.Admin, error) {
	return r.db.Admin.Create().
		SetUsername(admin.Username).
		SetPassword(admin.Password).
		SetStatus(admin.Status).
		Save(ctx)

}

func (r *UserRepo) AdminByName(ctx context.Context, username string) (*db.Admin, error) {
	return r.db.Admin.Query().Where(admin.Username(username)).Only(ctx)
}

func (r *UserRepo) GetByName(ctx context.Context, username string) (*db.User, error) {
	return r.db.User.Query().Where(
		user.Or(
			user.Username(username),
			user.Email(username),
		),
	).Only(ctx)
}

func (r *UserRepo) ValidateInviteCode(ctx context.Context, code string) (*db.InviteCode, error) {
	return r.db.InviteCode.Query().Where(invitecode.Code(code)).Only(ctx)
}

func (r *UserRepo) CreateUser(ctx context.Context, user *db.User) (*db.User, error) {
	return r.db.User.Create().
		SetUsername(user.Username).
		SetEmail(user.Email).
		SetPassword(user.Password).
		SetStatus(user.Status).
		Save(ctx)
}

func (r *UserRepo) UserLoginHistory(ctx context.Context, page *web.Pagination) ([]*db.UserLoginHistory, *db.PageInfo, error) {
	q := r.db.UserLoginHistory.Query()
	return q.Page(ctx, page.Page, page.Size)
}

func (r *UserRepo) AdminLoginHistory(ctx context.Context, page *web.Pagination) ([]*db.AdminLoginHistory, *db.PageInfo, error) {
	q := r.db.AdminLoginHistory.Query()
	return q.Page(ctx, page.Page, page.Size)
}

func (r *UserRepo) CreateInviteCode(ctx context.Context, userID string, code string) (*db.InviteCode, error) {
	adminID, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}

	return r.db.InviteCode.Create().
		SetAdminID(adminID).
		SetCode(code).
		Save(ctx)
}

func (r *UserRepo) AdminList(ctx context.Context, page *web.Pagination) ([]*db.Admin, *db.PageInfo, error) {
	q := r.db.Admin.Query()
	return q.Page(ctx, page.Page, page.Size)
}

func (r *UserRepo) List(ctx context.Context, page *web.Pagination) ([]*db.User, *db.PageInfo, error) {
	q := r.db.User.Query()
	return q.Page(ctx, page.Page, page.Size)
}

func (r *UserRepo) GetOrCreateApiKey(ctx context.Context, userID string) (*db.ApiKey, error) {
	i, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}

	var apiKey *db.ApiKey
	err = entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		k, err := tx.ApiKey.Query().Where(apikey.UserID(i)).First(ctx)
		if db.IsNotFound(err) {
			n, err := tx.ApiKey.Create().
				SetUserID(i).
				SetKey(uuid.NewString()).
				SetName("default").
				SetStatus(consts.ApiKeyStatusActive).
				Save(ctx)
			if err != nil {
				return err
			}
			apiKey = n
			return nil
		}
		if err != nil {
			return err
		}
		apiKey = k
		return nil
	})
	return apiKey, err
}

func (r *UserRepo) GetSetting(ctx context.Context) (*db.Setting, error) {
	s, err := r.db.Setting.Query().First(ctx)
	if db.IsNotFound(err) {
		return r.db.Setting.Create().
			SetEnableSSO(false).
			SetForceTwoFactorAuth(false).
			SetDisablePasswordLogin(false).
			Save(ctx)
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *UserRepo) UpdateSetting(ctx context.Context, fn func(*db.SettingUpdateOne)) (*db.Setting, error) {
	var s *db.Setting
	err := entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		s, err := tx.Setting.Query().First(ctx)
		if err != nil {
			return err
		}
		up := tx.Setting.UpdateOneID(s.ID)
		fn(up)
		return up.Exec(ctx)
	})
	return s, err
}

func (r *UserRepo) Update(ctx context.Context, id string, fn func(*db.UserUpdateOne) error) (*db.User, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}

	var u *db.User
	err = entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		u, err = tx.User.Query().Where(user.ID(uid)).Only(ctx)
		if err != nil {
			return err
		}
		if err := fn(u.Update()); err != nil {
			return err
		}
		return u.Update().Exec(ctx)
	})
	return u, err
}

func (r *UserRepo) Delete(ctx context.Context, id string) error {
	uid, err := uuid.Parse(id)
	if err != nil {
		return err
	}
	return r.db.User.DeleteOneID(uid).Exec(ctx)
}

func (r *UserRepo) DeleteAdmin(ctx context.Context, id string) error {
	uid, err := uuid.Parse(id)
	if err != nil {
		return err
	}
	admin, err := r.db.Admin.Get(ctx, uid)
	if err != nil {
		return err
	}
	if admin.Username == "admin" {
		return errors.New("admin cannot be deleted")
	}
	return r.db.Admin.DeleteOne(admin).Exec(ctx)
}
