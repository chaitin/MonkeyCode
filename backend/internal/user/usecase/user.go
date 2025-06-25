package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/GoYoko/web"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type UserUsecase struct {
	cfg    *config.Config
	redis  *redis.Client
	repo   domain.UserRepo
	logger *slog.Logger
}

func NewUserUsecase(
	cfg *config.Config,
	redis *redis.Client,
	repo domain.UserRepo,
	logger *slog.Logger,
) domain.UserUsecase {
	u := &UserUsecase{
		cfg:    cfg,
		redis:  redis,
		repo:   repo,
		logger: logger,
	}
	return u
}

func (u *UserUsecase) InitAdmin(ctx context.Context) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(u.cfg.Admin.Password), bcrypt.DefaultCost)
	if err != nil {
		u.logger.Error("generate admin password", "error", err)
		return err
	}
	return u.repo.InitAdmin(ctx, u.cfg.Admin.User, string(hash))
}

func (u *UserUsecase) List(ctx context.Context, req domain.ListReq) (*domain.ListUserResp, error) {
	users, p, err := u.repo.List(ctx, &req.Pagination)
	if err != nil {
		return nil, err
	}

	return &domain.ListUserResp{
		PageInfo: p,
		Users: cvt.Iter(users, func(_ int, e *db.User) *domain.User {
			return cvt.From(e, &domain.User{}).From(e)
		}),
	}, nil
}

// AdminList implements domain.UserUsecase.
func (u *UserUsecase) AdminList(ctx context.Context, page *web.Pagination) (*domain.ListAdminUserResp, error) {
	admins, p, err := u.repo.AdminList(ctx, page)
	if err != nil {
		return nil, err
	}

	return &domain.ListAdminUserResp{
		PageInfo: p,
		Users: cvt.Iter(admins, func(_ int, e *db.Admin) *domain.AdminUser {
			return cvt.From(e, &domain.AdminUser{}).From(e)
		}),
	}, nil
}

// AdminLoginHistory implements domain.UserUsecase.
func (u *UserUsecase) AdminLoginHistory(ctx context.Context, page *web.Pagination) (*domain.ListAdminLoginHistoryResp, error) {
	histories, p, err := u.repo.AdminLoginHistory(ctx, page)
	if err != nil {
		return nil, err
	}

	return &domain.ListAdminLoginHistoryResp{
		PageInfo: p,
		LoginHistories: cvt.Iter(histories, func(_ int, e *db.AdminLoginHistory) *domain.AdminLoginHistory {
			return cvt.From(e, &domain.AdminLoginHistory{}).From(e)
		}),
	}, nil
}

// Invite implements domain.UserUsecase.
func (u *UserUsecase) Invite(ctx context.Context, userID string) (*domain.InviteResp, error) {
	icode := uuid.NewString()
	code, err := u.repo.CreateInviteCode(ctx, userID, icode)
	if err != nil {
		return nil, err
	}
	return &domain.InviteResp{
		Code: code.Code,
	}, nil
}

// LoginHistory implements domain.UserUsecase.
func (u *UserUsecase) LoginHistory(ctx context.Context, page *web.Pagination) (*domain.ListLoginHistoryResp, error) {
	histories, p, err := u.repo.UserLoginHistory(ctx, page)
	if err != nil {
		return nil, err
	}

	return &domain.ListLoginHistoryResp{
		PageInfo: p,
		LoginHistories: cvt.Iter(histories, func(_ int, e *db.UserLoginHistory) *domain.UserLoginHistory {
			return cvt.From(e, &domain.UserLoginHistory{}).From(e)
		}),
	}, nil
}

// Register implements domain.UserUsecase.
func (u *UserUsecase) Register(ctx context.Context, req *domain.RegisterReq) (*domain.User, error) {
	if _, err := u.repo.ValidateInviteCode(ctx, req.Code); err != nil {
		return nil, errcode.ErrInviteCodeInvalid.Wrap(err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(req.Email, "@")
	if len(parts) != 2 {
		return nil, errcode.ErrEmailInvalid
	}
	user := &db.User{
		Username: parts[0],
		Email:    req.Email,
		Password: string(hash),
	}
	n, err := u.repo.CreateUser(ctx, user)
	if err != nil {
		return nil, err
	}

	return cvt.From(n, &domain.User{}), nil
}

func (u *UserUsecase) Login(ctx context.Context, req *domain.LoginReq) (*domain.LoginResp, error) {
	s, err := u.redis.Get(ctx, fmt.Sprintf("vscode:session:%s", req.SessionID)).Result()
	if err != nil {
		return nil, err
	}
	session := &domain.VSCodeSession{}
	if err := json.Unmarshal([]byte(s), session); err != nil {
		return nil, err
	}

	user, err := u.repo.GetByName(ctx, req.Username)
	if err != nil {
		return nil, errcode.ErrUserNotFound.Wrap(err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return nil, errcode.ErrPassword.Wrap(err)
	}

	apiKey, err := u.repo.GetOrCreateApiKey(ctx, user.ID.String())
	if err != nil {
		return nil, err
	}

	r := fmt.Sprintf("%s?state=%s&api_key=%s&expires_in=3600&username=%s", session.RedirectURI, session.State, apiKey.Key, user.Username)
	return &domain.LoginResp{
		RedirectURL: r,
	}, nil
}

func (u *UserUsecase) AdminLogin(ctx context.Context, req *domain.LoginReq) (*domain.AdminUser, error) {
	admin, err := u.repo.AdminByName(ctx, req.Username)
	if err != nil {
		return nil, errcode.ErrUserNotFound.Wrap(err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(admin.Password), []byte(req.Password)); err != nil {
		return nil, errcode.ErrPassword.Wrap(err)
	}
	return cvt.From(admin, &domain.AdminUser{}), nil
}

func (u *UserUsecase) VSCodeAuthInit(ctx context.Context, req *domain.VSCodeAuthInitReq) (*domain.VSCodeAuthInitResp, error) {
	i := uuid.NewString()
	session := &domain.VSCodeSession{
		ID:          i,
		State:       req.State,
		RedirectURI: req.RedirectURI,
	}

	b, err := json.Marshal(session)
	if err != nil {
		return nil, err
	}
	if err := u.redis.Set(ctx, fmt.Sprintf("vscode:session:%s", i), b, 15*time.Minute).Err(); err != nil {
		return nil, err
	}
	return &domain.VSCodeAuthInitResp{
		AuthURL: fmt.Sprintf("%s?session_id=%s", u.cfg.BaseUrl+"/auth", i),
	}, nil
}

func (u *UserUsecase) CreateAdmin(ctx context.Context, req *domain.CreateAdminReq) (*domain.AdminUser, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	admin := &db.Admin{
		Username: req.Username,
		Password: string(hash),
	}
	n, err := u.repo.CreateAdmin(ctx, admin)
	if err != nil {
		return nil, err
	}
	return &domain.AdminUser{
		ID:        n.ID.String(),
		Username:  n.Username,
		CreatedAt: n.CreatedAt.Unix(),
	}, nil
}

func (u *UserUsecase) GetSetting(ctx context.Context) (*domain.Setting, error) {
	s, err := u.repo.GetSetting(ctx)
	if err != nil {
		return nil, err
	}
	return cvt.From(s, &domain.Setting{}), nil
}

func (u *UserUsecase) UpdateSetting(ctx context.Context, req *domain.UpdateSettingReq) (*domain.Setting, error) {
	s, err := u.repo.UpdateSetting(ctx, func(s *db.SettingUpdateOne) {
		if req.EnableSSO != nil {
			s.SetEnableSSO(*req.EnableSSO)
		}
		if req.ForceTwoFactorAuth != nil {
			s.SetForceTwoFactorAuth(*req.ForceTwoFactorAuth)
		}
		if req.DisablePasswordLogin != nil {
			s.SetDisablePasswordLogin(*req.DisablePasswordLogin)
		}
	})
	if err != nil {
		return nil, err
	}
	return cvt.From(s, &domain.Setting{}), nil
}

func (u *UserUsecase) Update(ctx context.Context, req *domain.UpdateUserReq) (*domain.User, error) {
	user, err := u.repo.Update(ctx, req.ID, func(u *db.UserUpdateOne) error {
		if req.Status != nil {
			u.SetStatus(*req.Status)
		}
		if req.Password != nil {
			hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			u.SetPassword(string(hash))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return cvt.From(user, &domain.User{}), nil
}

func (u *UserUsecase) Delete(ctx context.Context, id string) error {
	return u.repo.Delete(ctx, id)
}

func (u *UserUsecase) DeleteAdmin(ctx context.Context, id string) error {
	return u.repo.DeleteAdmin(ctx, id)
}
