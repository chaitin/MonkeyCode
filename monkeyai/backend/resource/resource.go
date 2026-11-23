package resource

import (
	"context"
	core "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5"
	"net/http"
)

type Object = core.Object
type Queryer = core.Queryer
type Storage = core.Storage

const RootGroupID = rootgroup.ID

func ID() string            { return core.ID() }
func Hash(value any) string { return core.Hash(value) }
func JSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	core.JSON(ctx, w, status, value)
}
func Fail(ctx context.Context, w http.ResponseWriter, err error) { core.Fail(ctx, w, err) }
func PageParamsWithLimit(r *http.Request, max int) (int, int, error) {
	return core.PageParamsWithLimit(r, max)
}
func Allowed(ctx context.Context, q Queryer, kind, id, user string) (bool, error) {
	return core.Allowed(ctx, q, kind, id, user)
}
func Grants(ctx context.Context, q Queryer, kind, id string) ([]Object, error) {
	return core.Grants(ctx, q, kind, id)
}
func SaveGrants(ctx context.Context, tx pgx.Tx, kind, id, actor string, raw any, personal bool) error {
	return core.SaveGrants(ctx, tx, kind, id, actor, raw, personal)
}
func Audit(ctx context.Context, tx pgx.Tx, actor, kind, id, action string) error {
	return core.Audit(ctx, tx, actor, kind, id, action)
}
