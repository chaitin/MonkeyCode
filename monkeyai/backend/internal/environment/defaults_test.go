package environment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

type architectureImages map[string]string

func (images architectureImages) Default(ctx context.Context, arch string) (string, string, error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	reference, ok := images[arch]
	if !ok {
		return "", "", fmt.Errorf("默认环境镜像尚未准备对应架构")
	}
	return reference, reference[strings.LastIndexByte(reference, '@')+1:], nil
}
func TestDefaultImageChangeKeepsExistingSnapshot(t *testing.T) {
	service, user, host := fixture(t)
	ctx := t.Context()
	first, err := service.Create(ctx, user, Creation{Name: "已有环境", RequestKey: "old-image"})
	if err != nil {
		t.Fatal(err)
	}
	nextImage := "example.com/next@sha256:" + strings.Repeat("b", 64)
	service.WithImages(fixtureImages{nextImage})
	second, err := service.Create(ctx, user, Creation{Name: "新环境", RequestKey: "new-image"})
	if err != nil {
		t.Fatal(err)
	}
	var before, after Spec
	if json.Unmarshal(first.Environment.Spec, &before) != nil || json.Unmarshal(second.Environment.Spec, &after) != nil || before.Image == after.Image || after.Image != nextImage || after.ImageDigest != "sha256:"+strings.Repeat("b", 64) {
		t.Fatal(before, after)
	}
	syncState(t, service, host, observe(first.Environment, "running"))
	stopped, err := service.Change(ctx, &user, first.Environment.ID, "stopped", Change{Generation: 1, RequestKey: "stop-old-image"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, service, host, observe(stopped.Environment, "stopped"))
	started, err := service.Change(ctx, &user, first.Environment.ID, "running", Change{Generation: 2, RequestKey: "start-old-image"})
	if err != nil {
		t.Fatal(err)
	}
	var resumed Spec
	if json.Unmarshal(started.Environment.Spec, &resumed) != nil || resumed.Image != before.Image || resumed.ImageDigest != before.ImageDigest || started.Environment.InstanceID != first.Environment.InstanceID {
		t.Fatal("默认镜像变化改写已有系统快照", resumed)
	}
}
func TestSharedResourcesScheduleBothArchitectures(t *testing.T) {
	service, user, amd, arm := schedulingFixture(t)
	ctx := t.Context()
	if _, err := service.pool.Exec(ctx, "UPDATE hosts SET architecture='arm64' WHERE id=$1", arm); err != nil {
		t.Fatal(err)
	}
	references := architectureImages{"amd64": "server.example/environments/amd@sha256:" + strings.Repeat("a", 64), "arm64": "server.example/environments/arm@sha256:" + strings.Repeat("b", 64)}
	service.WithImages(references)
	counts := map[string]int{}
	for i := range 3 {
		created, err := service.Create(ctx, user, Creation{Name: "共享资源", RequestKey: fmt.Sprint("architecture-", i)})
		if err != nil {
			t.Fatal(err)
		}
		arch := "amd64"
		if created.Environment.HostID == arm {
			arch = "arm64"
		} else if created.Environment.HostID != amd {
			t.Fatal(created)
		}
		var spec Spec
		if json.Unmarshal(created.Environment.Spec, &spec) != nil || spec.Image != references[arch] || spec.Resource != profile().Resource {
			t.Fatal("资源或镜像架构未自动适配", spec, arch)
		}
		counts[arch]++
	}
	if counts["amd64"] != 1 || counts["arm64"] != 2 {
		t.Fatal("仍被单个预设架构绑定", counts)
	}
}
func TestCreationRejectsUnpreparedDefaultWithoutReservations(t *testing.T) {
	service, user, _ := fixture(t)
	ctx := t.Context()
	service.WithImages(architectureImages{})
	_, err := service.Create(ctx, user, Creation{Name: "未准备", RequestKey: "unprepared-default"})
	var failure *failure
	if !errors.As(err, &failure) || failure.code != "configuration_unavailable" {
		t.Fatal(err)
	}
	usage, err := sqlc.New(service.pool).UserUsage(ctx, user)
	if err != nil || usage != 0 {
		t.Fatal("失败创建遗留预留", usage, err)
	}
}
