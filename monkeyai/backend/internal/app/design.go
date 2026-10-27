package app

import (
	"context"
	"log/slog"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
)

type designDevices struct{ store *endpoint.Postgres }

func (d designDevices) OwnedDevice(ctx context.Context, user, machine string) (string, error) {
	if _, err := uuid.Parse(machine); err != nil {
		slog.WarnContext(ctx, "操作失败", "module", "app", "operation", "OwnedDevice", "error", err)
		return "", &designcatalog.Fault{Status: 403, Code: "forbidden", Message: "设备标识无效"}
	}
	row, err := d.store.Get(ctx, user, machine)
	if err != nil {
		if err.Error() == "endpoint_not_found" {
			return "", &designcatalog.Fault{Status: 403, Code: "forbidden", Message: "设备不属于当前用户"}
		}
		return "", err
	}
	if row.Status != "active" || row.RevokedAt != nil {
		return "", &designcatalog.Fault{Status: 403, Code: "forbidden", Message: "设备已移除"}
	}
	return row.MachineID, nil
}
