package member

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrSeatsExceeded    = errors.New("成员席位已满")
	ErrSeatsUnavailable = errors.New("成员席位授权不可用")
)

type User struct {
	ID          string
	Name        string
	Email       string
	AvatarURL   string
	Role        string
	Status      string
	JoinedAt    time.Time
	LastLoginAt *time.Time
}

type InitialAdmin struct {
	Name     string
	Email    string
	Password string
}

type CreateUser struct {
	ActorID  string
	Name     string
	Email    string
	Role     string
	Password string
	GroupIDs []string
}

type UpdateUser struct {
	ID     string
	Name   string
	Role   string
	Status string
}

type OAuthIdentity struct {
	Provider                string
	Issuer                  string
	Subject                 string
	Username                string
	Name                    string
	Email                   string
	AvatarURL               string
	AdminOnly               bool
	AutoRegistrationEnabled bool
}

type PasswordReset struct {
	Email    string
	Password string
}

// 接收 pgx.Tx 的方法参与调用方事务，不自行提交或回滚。
type UserWriter interface {
	EnsureInitialAdmin(context.Context, InitialAdmin) error
	CreateUser(context.Context, CreateUser) (User, error)
	UpdateUser(context.Context, UpdateUser) (User, error)
	RegisterEmailUser(context.Context, pgx.Tx, string) (User, error)
	UpsertIdentity(context.Context, OAuthIdentity) (User, error)
	ResetPassword(context.Context, pgx.Tx, PasswordReset) error
	ResetUserPassword(context.Context, pgx.Tx, string) (string, error)
	TouchLogin(context.Context, string) error
}

type GroupMembers struct {
	ActorID string
	GroupID string
	UserIDs []string
}

type MoveMember struct {
	ID            string
	SourceGroupID *string
}

type MoveMembers struct {
	ActorID       string
	TargetGroupID *string
	Members       []MoveMember
}

// 接收 pgx.Tx 的方法参与调用方事务，不自行提交或回滚。
type GroupWriter interface {
	SetMembers(context.Context, pgx.Tx, GroupMembers) error
	MoveMembers(context.Context, pgx.Tx, MoveMembers) error
	RemoveAllMembers(context.Context, pgx.Tx, string) error
}
