package environment

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type taggedImage struct{}

func (taggedImage) Default(ctx context.Context, arch string) (string, string, error) {
	return "server.example/environments/monkeyai-environment:runtime-26.1105.2", "sha256:" + strings.Repeat("a", 64), ctx.Err()
}
func TestVersionTagUsesSeparateDigestAndNewHostProtocol(t *testing.T) {
	service, user, host := fixture(t)
	service.WithImages(taggedImage{})
	if _, err := service.Create(t.Context(), user, Creation{Name: "旧引擎", RequestKey: "tag-old-host"}); err == nil {
		t.Fatal("将版本标签下发给仅支持摘要引用的旧引擎")
	}
	if _, err := service.pool.Exec(t.Context(), `UPDATE hosts SET report=report || '{"environment_protocol":3}'::jsonb WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), user, Creation{Name: "可读镜像", RequestKey: "version-tag-create"})
	if err != nil {
		t.Fatal(err)
	}
	var spec Spec
	if json.Unmarshal(created.Environment.Spec, &spec) != nil || spec.Image != "server.example/environments/monkeyai-environment:runtime-26.1105.2" || spec.ImageDigest != "sha256:"+strings.Repeat("a", 64) || !spec.PersistentContainer {
		t.Fatal(spec)
	}
}
func TestVersionTagRequiresPinnedDigest(t *testing.T) {
	profile := profile()
	profile.Image = "server.example/environments/dev:v1"
	if profile.Validate() == nil {
		t.Fatal("未固定摘要仍接受标签")
	}
	profile.ImageDigest = "sha256:" + strings.Repeat("a", 64)
	if err := profile.Validate(); err != nil {
		t.Fatal(err)
	}
	spec := profile.Spec("environment")
	if spec.Image != profile.Image || spec.ImageDigest != profile.ImageDigest {
		t.Fatal(spec)
	}
	profile.Image = "server.example/environments/dev:latest"
	if profile.Validate() == nil {
		t.Fatal("接受了浮动latest版本")
	}
}
