package identity

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResetAdminPassword 用于离线恢复管理员密码，不依赖成员写入或席位授权。
func ResetAdminPassword(ctx context.Context, db *pgxpool.Pool, email string) (string, error) {
	password, err := generatePassword()
	if err != nil {
		return "", fmt.Errorf("生成密码: %w", err)
	}
	hash, err := hashPassword(password)
	if err != nil {
		return "", fmt.Errorf("生成密码哈希: %w", err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "ResetAdminPassword", "error", err)
		}
	}()
	q := sqlc.New(tx)
	user, err := q.ResetAdminPassword(ctx, sqlc.ResetAdminPasswordParams{
		Email: strings.ToLower(strings.TrimSpace(email)), PasswordHash: new(hash),
	})
	if err != nil {
		return "", err
	}
	if err := revokePasswordAccess(ctx, q, user.ID, user.Email); err != nil {
		return "", err
	}
	if err := q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: user.Email, Purpose: "reset"}); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return password, nil
}
