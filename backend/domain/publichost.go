package domain

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/db"
)

// PublicHostUsecase 公共主机业务逻辑接口
type PublicHostUsecase interface {
	PickHost(ctx context.Context) (*Host, error)
}

// PublicHostRepo 公共主机数据访问接口
type PublicHostRepo interface {
	All(ctx context.Context) ([]*db.Host, error)
}
