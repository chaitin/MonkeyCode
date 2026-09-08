package resource

import "context"

type Repository interface {
	GetResource(context.Context, string) ([]byte, error)
	LockResource(context.Context, string) ([]byte, error)
	ListResources(context.Context) ([][]byte, error)
	PageResources(context.Context, []byte) ([][]byte, error)
	CreateResource(context.Context, []byte) error
	UpdateResource(context.Context, []byte) error
	DeleteResource(context.Context, string) error
	TouchResource(context.Context, string) error
}
