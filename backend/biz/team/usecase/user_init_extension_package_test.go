package usecase

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestImportInitTeamExtensionPackagesSortsZipFiles(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{
		"002-default-skills.zip": "skills",
		"001-default-rules.zip":  "rules",
		"README.md":              "ignored",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	importer := &initPackageImporterStub{}
	u := &TeamGroupUserUsecase{
		config:                  &config.Config{},
		logger:                  slog.Default(),
		extensionPackageUsecase: importer,
	}
	u.config.InitTeam.ExtensionPackageDir = dir

	u.importInitTeamExtensionPackages(context.Background(), &domain.InitTeamResult{
		TeamID: uuid.New(),
		UserID: uuid.New(),
	})

	if want := []string{"001-default-rules.zip", "002-default-skills.zip"}; !reflect.DeepEqual(importer.names, want) {
		t.Fatalf("import order = %v, want %v", importer.names, want)
	}
}

type initPackageImporterStub struct {
	names []string
}

func (s *initPackageImporterStub) Import(_ context.Context, _ *domain.TeamUser, req *domain.ImportTeamExtensionPackageReq) (*domain.ImportTeamExtensionPackageResp, error) {
	s.names = append(s.names, req.Filename)
	return &domain.ImportTeamExtensionPackageResp{PackageID: req.Filename, Version: "1.0.0"}, nil
}
