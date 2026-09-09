package rule

import (
	"context"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rule/sqlc"

	"github.com/jackc/pgx/v5"
)

func NewService(s *resource.Store) *resource.CRUD {
	return resource.NewCRUD(s, resource.Definition{Kind: "rule", Repository: func(q resource.Queryer) resource.Repository { return sqlc.New(q) }, Path: "/rules", Fields: []string{"name", "content"}, UserFields: []string{"name", "content"}, Validate: func(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
		if strings.TrimSpace(in.String("content")) == "" {
			return resource.Invalid("规则正文不能为空")
		}
		return nil
	}, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.DecodeObjects(sqlc.New(tx).ListReferences(ctx, id))
	}})
}
