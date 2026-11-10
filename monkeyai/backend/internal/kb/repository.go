package kb

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type repository struct {
	q resource.Queryer
}

func newRepository(q resource.Queryer) resource.Repository {
	return repository{q: q}
}

func (r repository) GetResource(ctx context.Context, id string) ([]byte, error) {
	return sqlc.New(r.q).GetKbResource(ctx, id)
}

func (r repository) LockResource(ctx context.Context, id string) ([]byte, error) {
	return sqlc.New(r.q).LockKbResource(ctx, id)
}

func (r repository) ListResources(ctx context.Context) ([][]byte, error) {
	return sqlc.New(r.q).ListKbResources(ctx)
}

func (r repository) PageResources(ctx context.Context, filter []byte) ([][]byte, error) {
	return sqlc.New(r.q).PageKbResources(ctx, filter)
}

func (r repository) CreateResource(ctx context.Context, data []byte) error {
	return sqlc.New(r.q).CreateKbResource(ctx, data)
}

func (r repository) UpdateResource(ctx context.Context, data []byte) error {
	return sqlc.New(r.q).UpdateKbResource(ctx, data)
}

func (r repository) DeleteResource(ctx context.Context, id string) error {
	return sqlc.New(r.q).DeleteKbResource(ctx, id)
}

func (r repository) TouchResource(ctx context.Context, id string) error {
	return sqlc.New(r.q).TouchKbResource(ctx, id)
}

func (r repository) SetResourceEnabled(ctx context.Context, data []byte) error {
	return sqlc.New(r.q).SetKbResourceEnabled(ctx, data)
}
