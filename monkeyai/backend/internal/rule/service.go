package rule

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"strings"
)

func NewService(s *resource.Store) *resource.CRUD {
	return resource.NewCRUD(s, resource.Definition{Kind: "rule", Table: "rules", Path: "/rules", Fields: []string{"name", "content"}, Validate: func(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
		if strings.TrimSpace(in.String("content")) == "" {
			return resource.Invalid("规则正文不能为空")
		}
		return nil
	}, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.Rows(ctx, tx, `SELECT jsonb_build_object('id',e.id,'name',e.name) FROM experts e JOIN expert_rules x ON x.expert_id=e.id WHERE x.rule_id=$1 AND e.deleted_at IS NULL`, id)
	}})
}
