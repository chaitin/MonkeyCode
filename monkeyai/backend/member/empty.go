package member

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrWriterUnavailable = errors.New("成员写入实现不可用")

type EmptyUserWriter struct{}

func (EmptyUserWriter) EnsureInitialAdmin(context.Context, InitialAdmin) error {
	return ErrWriterUnavailable
}

func (EmptyUserWriter) CreateUser(context.Context, CreateUser) (User, error) {
	return User{}, ErrWriterUnavailable
}

func (EmptyUserWriter) UpdateUser(context.Context, pgx.Tx, UpdateUser) (User, error) {
	return User{}, ErrWriterUnavailable
}

func (EmptyUserWriter) RegisterEmailUser(context.Context, pgx.Tx, string) (User, error) {
	return User{}, ErrWriterUnavailable
}

func (EmptyUserWriter) UpsertIdentity(context.Context, OAuthIdentity) (User, error) {
	return User{}, ErrWriterUnavailable
}

func (EmptyUserWriter) ResetPassword(context.Context, pgx.Tx, PasswordReset) (string, error) {
	return "", ErrWriterUnavailable
}

func (EmptyUserWriter) ResetUserPassword(context.Context, pgx.Tx, string, string) error {
	return ErrWriterUnavailable
}

func (EmptyUserWriter) TouchLogin(context.Context, string) error {
	return ErrWriterUnavailable
}

type EmptyGroupWriter struct{}

func (EmptyGroupWriter) SetMembers(context.Context, pgx.Tx, GroupMembers) error {
	return ErrWriterUnavailable
}

func (EmptyGroupWriter) MoveMembers(context.Context, pgx.Tx, MoveMembers) error {
	return ErrWriterUnavailable
}

func (EmptyGroupWriter) RemoveAllMembers(context.Context, pgx.Tx, string) error {
	return ErrWriterUnavailable
}
