package vmhost

import (
	"context"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
)

func (d *Driver) Cache(context.Context, bool) (cache.Report, error) {
	return cache.Report{}, errors.New("虚拟机模板清理尚未接入，保留全部模板及用户磁盘")
}
