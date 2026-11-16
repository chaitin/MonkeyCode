package vmimage

import (
	"context"
	"math"
	"testing"
)

func TestLayoutRejectsUnboundedBudget(t *testing.T) {
	dir, manifest, _ := layoutFixture(t, false)
	if _, err := InspectLayout(context.Background(), dir, manifest.Digest, "amd64", math.MaxInt64); err == nil {
		t.Fatal("接受了可能导致计数溢出的预算")
	}
}

func TestLayoutRejectsInvalidChildSizes(t *testing.T) {
	for _, size := range []int64{-1, 0} {
		t.Run(string(rune('a'+size+1)), func(t *testing.T) {
			dir, manifest, _ := layoutFixture(t, false)
			manifest.Size = size
			manifest.Platform = &Platform{OS: "linux", Architecture: "amd64"}
			index := putJSON(t, dir, ociIndex, imageManifest{SchemaVersion: 2, MediaType: ociIndex, Manifests: []Descriptor{manifest}})
			if _, err := InspectLayout(context.Background(), dir, index.Digest, "amd64", 1<<20); err == nil {
				t.Fatal("接受了无效的子清单长度")
			}
		})
	}
}
