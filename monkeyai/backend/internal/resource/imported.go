package resource

import (
	"context"
	"errors"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
	"github.com/jackc/pgx/v5"
)

var ImportedReadOnly = &Error{Status: 409, Code: "package_resource_read_only", Message: "资源由发布包管理，不允许人工修改"}

func Imported(ctx context.Context, q Queryer, kind, id string) (bool, error) {
	_, err := sqlc.New(q).GetResourceImport(ctx, sqlc.GetResourceImportParams{ResourceType: kind, ResourceID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func RequireEditable(ctx context.Context, tx pgx.Tx, kind, id string) error {
	_, err := sqlc.New(tx).LockResourceImport(ctx, sqlc.LockResourceImportParams{ResourceType: kind, ResourceID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return ImportedReadOnly
}
