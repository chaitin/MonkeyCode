package identity

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

func (s *Service) insertUser(ctx context.Context, name, email, role, passwordHash string) (User, error) {
	var password *string
	if passwordHash != "" {
		password = new(passwordHash)
	}
	row, err := sqlc.New(s.db).CreateUser(ctx, sqlc.CreateUserParams{
		Name: name, Email: email, Role: role, PasswordHash: password,
	})
	return User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, err
}
