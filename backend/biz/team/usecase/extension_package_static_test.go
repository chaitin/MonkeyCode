package usecase

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPublishExtensionImagesWritesArchiveAndManifest(t *testing.T) {
	dir := t.TempDir()
	teamID := uuid.New()
	pkg := &parsedExtensionPackage{
		PackageID: "pack",
		Version:   "1.0.0",
		Images: []parsedExtensionImage{{
			ImageID: "devbox",
			Name:    "repo/devbox:1",
			Archives: []parsedExtensionImageArchive{{
				Arch:     "x86_64",
				Filename: "devbox.tar.gz",
				Data:     []byte("image"),
				SHA256:   "",
			}},
		}},
	}
	published, err := publishExtensionImages(dir, "/static", teamID, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if len(published[0].Archives) != 1 {
		t.Fatalf("archives = %#v", published[0].Archives)
	}
	path := filepath.Join(dir, "extensions", "teams", teamID.String(), "pack", "1.0.0", "images", "x86_64", "devbox.tar.gz")
	if got, err := os.ReadFile(path); err != nil || string(got) != "image" {
		t.Fatalf("archive = %q, %v", got, err)
	}
	if !strings.Contains(published[0].Archives[0].ArchiveURL, "/static/extensions/teams/") {
		t.Fatalf("archive url = %q", published[0].Archives[0].ArchiveURL)
	}
}
