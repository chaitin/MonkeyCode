package v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const (
	recycledDeleteRetryTTL = 30 * time.Second
	recycledDeleteTimeout  = 5 * time.Second
)

var errAgentVMRecycled = errors.New("agent vm is recycled")

type vmDeleteLimiter interface {
	SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.BoolCmd
}

type vmDeleter interface {
	Delete(ctx context.Context, req *taskflow.DeleteVirtualMachineReq) error
}

type asyncRunner func(func())

func defaultAsyncRunner(fn func()) {
	go fn()
}

type agentTokenGetter func(ctx context.Context, key string) (string, error)

func defaultAgentTokenGetter(rdb *redis.Client) agentTokenGetter {
	const luaGetDel = `
local v = redis.call('GET', KEYS[1])
if v then
	 redis.call('DEL', KEYS[1])
	 return v
end
return nil
`
	return func(ctx context.Context, key string) (string, error) {
		res, err := rdb.Eval(ctx, luaGetDel, []string{key}).Result()
		if err != nil {
			return "", err
		}

		b, ok := res.(string)
		if !ok || b == "" {
			return "", redis.Nil
		}
		return b, nil
	}
}

func (h *InternalHostHandler) tryRecycledVMDelete(ctx context.Context, vm *db.VirtualMachine, machineID string) {
	if h.limiter == nil || h.vmDeleter == nil || h.runAsync == nil {
		h.logger.WarnContext(ctx, "skip recycled vm delete retry", "vm_id", vm.ID, "machine_id", machineID, "error", "missing dependency")
		return
	}

	key := fmt.Sprintf("vm:recycle:retry:%s", vm.ID)
	ok, err := h.limiter.SetNX(ctx, key, "1", recycledDeleteRetryTTL).Result()
	if err != nil || !ok {
		h.logger.WarnContext(ctx, "skip recycled vm delete retry", "vm_id", vm.ID, "machine_id", machineID, "rate_limited", !ok, "error", err)
		return
	}

	h.runAsync(func() {
		deleteCtx, cancel := context.WithTimeout(context.Background(), recycledDeleteTimeout)
		defer cancel()

		err := h.vmDeleter.Delete(deleteCtx, &taskflow.DeleteVirtualMachineReq{
			UserID: vm.UserID.String(),
			HostID: vm.HostID,
			ID:     vm.EnvironmentID,
		})
		if err != nil {
			h.logger.ErrorContext(deleteCtx, "reissue recycled vm delete failed", "vm_id", vm.ID, "machine_id", machineID, "error", err)
			return
		}
		h.logger.InfoContext(deleteCtx, "reissue recycled vm delete success", "vm_id", vm.ID, "machine_id", machineID)
	})
}
