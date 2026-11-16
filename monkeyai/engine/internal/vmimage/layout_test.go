package vmimage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func putBlob(t *testing.T, dir, media string, data []byte) Descriptor {
	t.Helper()
	sum := sha256.Sum256(data)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	path := filepath.Join(dir, "blobs", "sha256", strings.TrimPrefix(digest, "sha256:"))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return Descriptor{MediaType: media, Digest: digest, Size: int64(len(data))}
}

func putJSON(t *testing.T, dir, media string, value any) Descriptor {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return putBlob(t, dir, media, data)
}

func layoutFixture(t *testing.T, compressed bool) (string, Descriptor, Descriptor) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte("layer-content"), 200)
	var archive bytes.Buffer
	writer := tar.NewWriter(&archive)
	if err := writer.WriteHeader(&tar.Header{Name: "proof", Mode: 0644, Typeflag: tar.TypeReg, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	payload := archive.Bytes()
	sum := sha256.Sum256(payload)
	diffID := "sha256:" + hex.EncodeToString(sum[:])
	media := "application/vnd.oci.image.layer.v1.tar"
	encoded := payload
	if compressed {
		var b bytes.Buffer
		z := gzip.NewWriter(&b)
		if _, err := z.Write(payload); err != nil {
			t.Fatal(err)
		}
		if err := z.Close(); err != nil {
			t.Fatal(err)
		}
		encoded = b.Bytes()
		media += "+gzip"
	}
	layer := putBlob(t, dir, media, encoded)
	config := putJSON(t, dir, "application/vnd.oci.image.config.v1+json", map[string]any{"architecture": "amd64", "os": "linux", "rootfs": map[string]any{"type": "layers", "diff_ids": []string{diffID}}})
	manifest := putJSON(t, dir, "application/vnd.oci.image.manifest.v1+json", map[string]any{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json", "config": config, "layers": []Descriptor{layer}})
	return dir, manifest, layer
}

func TestInspectLayout(t *testing.T) {
	for _, compressed := range []bool{false, true} {
		t.Run(map[bool]string{false: "tar", true: "gzip"}[compressed], func(t *testing.T) {
			dir, manifest, layer := layoutFixture(t, compressed)
			image, err := InspectLayout(context.Background(), dir, manifest.Digest, "amd64", 1<<20)
			if err != nil {
				t.Fatal(err)
			}
			if image.Manifest.Digest != manifest.Digest || len(image.Layers) != 1 || image.Layers[0].Digest != layer.Digest {
				t.Fatalf("unexpected image: %+v", image)
			}
			if _, err := InspectLayout(context.Background(), dir, manifest.Digest, "arm64", 1<<20); err == nil {
				t.Fatal("accepted wrong architecture")
			}
			if _, err := InspectLayout(context.Background(), dir, manifest.Digest, "amd64", 100); err == nil {
				t.Fatal("accepted excessive layer size")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := InspectLayout(ctx, dir, manifest.Digest, "amd64", 1<<20); err == nil {
				t.Fatal("ignored cancellation")
			}
		})
	}
}

func TestInspectLayoutIndex(t *testing.T) {
	dir, manifest, _ := layoutFixture(t, true)
	manifest.Platform = &Platform{Architecture: "amd64", OS: "linux"}
	index := putJSON(t, dir, "application/vnd.oci.image.index.v1+json", map[string]any{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": []Descriptor{manifest}})
	image, err := InspectLayout(context.Background(), dir, index.Digest, "amd64", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if image.Manifest.Digest != manifest.Digest {
		t.Fatal("index resolved to wrong manifest")
	}
	duplicate := putJSON(t, dir, "application/vnd.oci.image.index.v1+json", map[string]any{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": []Descriptor{manifest, manifest}})
	if _, err := InspectLayout(context.Background(), dir, duplicate.Digest, "amd64", 1<<20); err == nil {
		t.Fatal("accepted ambiguous platform")
	}
}

func TestInspectLayoutCorruption(t *testing.T) {
	for _, mutation := range []string{"digest", "truncated", "symlink", "diffID"} {
		t.Run(mutation, func(t *testing.T) {
			dir, manifest, layer := layoutFixture(t, true)
			path := filepath.Join(dir, "blobs", "sha256", strings.TrimPrefix(layer.Digest, "sha256:"))
			switch mutation {
			case "digest":
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				data[len(data)/2] ^= 1
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			case "truncated":
				if err := os.Truncate(path, 1); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("/etc/passwd", path); err != nil {
					t.Fatal(err)
				}
			case "diffID":
				config := putJSON(t, dir, "application/vnd.oci.image.config.v1+json", map[string]any{"architecture": "amd64", "os": "linux", "rootfs": map[string]any{"type": "layers", "diff_ids": []string{"sha256:" + strings.Repeat("0", 64)}}})
				manifest = putJSON(t, dir, "application/vnd.oci.image.manifest.v1+json", map[string]any{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json", "config": config, "layers": []Descriptor{layer}})
			}
			if _, err := InspectLayout(context.Background(), dir, manifest.Digest, "amd64", 1<<20); err == nil {
				t.Fatal("accepted corrupt image")
			}
		})
	}
}
