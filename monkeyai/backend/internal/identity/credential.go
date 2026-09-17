package identity

import (
	"context"
	"errors"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

type credentialKey struct{}

type AccessCredential struct {
	UserID    string
	Reference string
	ExpiresAt time.Time
}

func CredentialFromContext(ctx context.Context) (AccessCredential, bool) {
	credential, ok := ctx.Value(credentialKey{}).(AccessCredential)
	return credential, ok
}

func (s *Service) ValidCredential(ctx context.Context, credential AccessCredential) (bool, error) {
	row, err := sqlc.New(s.db).GetAccessCredential(ctx, credential.Reference)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return row.UserID == credential.UserID, nil
}
