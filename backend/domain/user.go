package domain

import (
	"context"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type UserUsecase interface {
	Login(ctx context.Context, req *LoginReq) (*LoginResp, error)
	Update(ctx context.Context, req *UpdateUserReq) (*User, error)
	Delete(ctx context.Context, id string) error
	InitAdmin(ctx context.Context) error
	AdminLogin(ctx context.Context, req *LoginReq) (*AdminUser, error)
	DeleteAdmin(ctx context.Context, id string) error
	CreateAdmin(ctx context.Context, req *CreateAdminReq) (*AdminUser, error)
	VSCodeAuthInit(ctx context.Context, req *VSCodeAuthInitReq) (*VSCodeAuthInitResp, error)
	List(ctx context.Context, req ListReq) (*ListUserResp, error)
	AdminList(ctx context.Context, page *web.Pagination) (*ListAdminUserResp, error)
	LoginHistory(ctx context.Context, page *web.Pagination) (*ListLoginHistoryResp, error)
	AdminLoginHistory(ctx context.Context, page *web.Pagination) (*ListAdminLoginHistoryResp, error)
	Invite(ctx context.Context, userID string) (*InviteResp, error)
	Register(ctx context.Context, req *RegisterReq) (*User, error)
	GetSetting(ctx context.Context) (*Setting, error)
	UpdateSetting(ctx context.Context, req *UpdateSettingReq) (*Setting, error)
}

type UserRepo interface {
	List(ctx context.Context, page *web.Pagination) ([]*db.User, *db.PageInfo, error)
	Update(ctx context.Context, id string, fn func(*db.UserUpdateOne) error) (*db.User, error)
	Delete(ctx context.Context, id string) error
	InitAdmin(ctx context.Context, username, password string) error
	CreateUser(ctx context.Context, user *db.User) (*db.User, error)
	CreateAdmin(ctx context.Context, admin *db.Admin) (*db.Admin, error)
	DeleteAdmin(ctx context.Context, id string) error
	AdminByName(ctx context.Context, username string) (*db.Admin, error)
	GetByName(ctx context.Context, username string) (*db.User, error)
	GetOrCreateApiKey(ctx context.Context, userID string) (*db.ApiKey, error)
	AdminList(ctx context.Context, page *web.Pagination) ([]*db.Admin, *db.PageInfo, error)
	CreateInviteCode(ctx context.Context, userID string, code string) (*db.InviteCode, error)
	ValidateInviteCode(ctx context.Context, code string) (*db.InviteCode, error)
	UserLoginHistory(ctx context.Context, page *web.Pagination) ([]*db.UserLoginHistory, *db.PageInfo, error)
	AdminLoginHistory(ctx context.Context, page *web.Pagination) ([]*db.AdminLoginHistory, *db.PageInfo, error)
	GetSetting(ctx context.Context) (*db.Setting, error)
	UpdateSetting(ctx context.Context, fn func(*db.SettingUpdateOne)) (*db.Setting, error)
}

type UpdateUserReq struct {
	ID       string             `json:"id" validate:"required"` // 用户ID
	Status   *consts.UserStatus `json:"status"`                 // 用户状态 active: 正常 locked: 锁定 inactive: 禁用
	Password *string            `json:"password"`               // 重置密码
}

type CreateAdminReq struct {
	Username string `json:"username"` // 用户名
	Password string `json:"password"` // 密码
}

type VSCodeAuthInitReq struct {
	ClientID    string `json:"client_id" validate:"required"`    // 客户端ID
	RedirectURI string `json:"redirect_uri" validate:"required"` // 重定向URI
	State       string `json:"state" validate:"required"`        // 状态
}

type VSCodeAuthInitResp struct {
	AuthURL string `json:"auth_url"` // 授权URL
}

type LoginReq struct {
	SessionID string `json:"session_id"` // 会话Id
	Username  string `json:"username"`   // 用户名
	Password  string `json:"password"`   // 密码
}

type AdminLoginReq struct {
	Account  string `json:"account"`  // 用户名
	Password string `json:"password"` // 密码
}

type LoginResp struct {
	RedirectURL string `json:"redirect_url"` // 重定向URL
}

type ListReq struct {
	web.Pagination

	Search string `json:"search" query:"search"` // 搜索
}

type RegisterReq struct {
	Email    string `json:"email"`    // 邮箱
	Password string `json:"password"` // 密码
	Code     string `json:"code"`     // 邀请码
}

type ListLoginHistoryResp struct {
	*db.PageInfo

	LoginHistories []*UserLoginHistory `json:"login_histories"`
}

type ListAdminLoginHistoryResp struct {
	*db.PageInfo

	LoginHistories []*AdminLoginHistory `json:"login_histories"`
}

type InviteResp struct {
	Code string `json:"code"` // 邀请码
}

type IPInfo struct {
	IP       string `json:"ip"`       // IP地址
	Country  string `json:"country"`  // 国家
	Province string `json:"province"` // 省份
	City     string `json:"city"`     // 城市
	ISP      string `json:"isp"`      // 运营商
	ASN      string `json:"asn"`      // ASN
}

type UserLoginHistory struct {
	User          *User   `json:"user"`           // 用户信息
	IPInfo        *IPInfo `json:"ip_info"`        // IP信息
	ClientVersion string  `json:"client_version"` // 客户端版本
	Device        string  `json:"device"`         // 设备信息
	CreatedAt     int64   `json:"created_at"`     // 登录时间
}

func (l *UserLoginHistory) From(e *db.UserLoginHistory) *UserLoginHistory {
	if e == nil {
		return l
	}

	l.User = cvt.From(e.Edges.Owner, &User{})
	l.IPInfo = &IPInfo{
		IP:       e.IP,
		Country:  e.Country,
		Province: e.Province,
		City:     e.City,
		ISP:      e.Isp,
		ASN:      e.Asn,
	}
	l.ClientVersion = e.ClientVersion
	l.Device = e.Device
	l.CreatedAt = e.CreatedAt.Unix()

	return l
}

type AdminLoginHistory struct {
	User          *AdminUser `json:"user"`           // 用户信息
	IPInfo        *IPInfo    `json:"ip_info"`        // IP信息
	ClientVersion string     `json:"client_version"` // 客户端版本
	Device        string     `json:"device"`         // 设备信息
	CreatedAt     int64      `json:"created_at"`     // 登录时间
}

func (l *AdminLoginHistory) From(e *db.AdminLoginHistory) *AdminLoginHistory {
	if e == nil {
		return l
	}

	l.User = cvt.From(e.Edges.Owner, &AdminUser{})
	l.IPInfo = &IPInfo{
		IP:       e.IP,
		Country:  e.Country,
		Province: e.Province,
		City:     e.City,
		ISP:      e.Isp,
		ASN:      e.Asn,
	}
	l.ClientVersion = e.ClientVersion
	l.Device = e.Device
	l.CreatedAt = e.CreatedAt.Unix()

	return l
}

type ListUserResp struct {
	*db.PageInfo

	Users []*User `json:"users"`
}

type ListAdminUserResp struct {
	*db.PageInfo

	Users []*AdminUser `json:"users"`
}

type User struct {
	ID           string            `json:"id"`             // 用户ID
	Username     string            `json:"username"`       // 用户名
	Email        string            `json:"email"`          // 邮箱
	TwoStepAuth  bool              `json:"two_step_auth"`  // 是否开启两步验证
	Status       consts.UserStatus `json:"status"`         // 用户状态 active: 正常 locked: 锁定 inactive: 禁用
	CreatedAt    int64             `json:"created_at"`     // 创建时间
	LastActiveAt int64             `json:"last_active_at"` // 最后活跃时间
}

func (u *User) From(e *db.User) *User {
	if e == nil {
		return u
	}

	u.ID = e.ID.String()
	u.Username = e.Username
	u.Email = e.Email
	u.Status = e.Status
	u.CreatedAt = e.CreatedAt.Unix()

	return u
}

type AdminUser struct {
	ID           string             `json:"id"`             // 用户ID
	Username     string             `json:"username"`       // 用户名
	LastActiveAt int64              `json:"last_active_at"` // 最后活跃时间
	Status       consts.AdminStatus `json:"status"`         // 用户状态 active: 正常 inactive: 禁用
	CreatedAt    int64              `json:"created_at"`     // 创建时间
}

func (a *AdminUser) From(e *db.Admin) *AdminUser {
	if e == nil {
		return a
	}

	a.ID = e.ID.String()
	a.Username = e.Username
	a.LastActiveAt = e.LastActiveAt.Unix()
	a.Status = e.Status
	a.CreatedAt = e.CreatedAt.Unix()

	return a
}

type VSCodeSession struct {
	ID          string `json:"id"`           // 会话ID
	State       string `json:"state"`        // 状态
	RedirectURI string `json:"redirect_uri"` // 重定向URI
}

type UpdateSettingReq struct {
	EnableSSO            *bool `json:"enable_sso"`             // 是否开启SSO
	ForceTwoFactorAuth   *bool `json:"force_two_factor_auth"`  // 是否强制两步验证
	DisablePasswordLogin *bool `json:"disable_password_login"` // 是否禁用密码登录
}

type Setting struct {
	EnableSSO            bool  `json:"enable_sso"`             // 是否开启SSO
	ForceTwoFactorAuth   bool  `json:"force_two_factor_auth"`  // 是否强制两步验证
	DisablePasswordLogin bool  `json:"disable_password_login"` // 是否禁用密码登录
	CreatedAt            int64 `json:"created_at"`             // 创建时间
	UpdatedAt            int64 `json:"updated_at"`             // 更新时间
}

func (s *Setting) From(e *db.Setting) *Setting {
	if e == nil {
		return s
	}

	s.EnableSSO = e.EnableSSO
	s.ForceTwoFactorAuth = e.ForceTwoFactorAuth
	s.DisablePasswordLogin = e.DisablePasswordLogin
	s.CreatedAt = e.CreatedAt.Unix()
	s.UpdatedAt = e.UpdatedAt.Unix()

	return s
}
