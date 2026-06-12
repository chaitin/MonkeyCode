package usecase

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestPackageSkillMarkdownContentCreatesRootSkillMarkdown(t *testing.T) {
	content := "---\nname: reviewer\ndescription: Review code\n---\n"
	data, err := packageSkillMarkdownContent(content)
	if err != nil {
		t.Fatal(err)
	}

	got := readZipFile(t, data, "SKILL.md")
	if got != content {
		t.Fatalf("SKILL.md content = %q, want %q", got, content)
	}
}

func TestTeamSkillUsecaseAddUploadsPackageAndKeepsContent(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &teamSkillRepoStub{}
	store := &skillPackageStoreStub{}
	u := &teamSkillUsecase{
		repo:         repo,
		packageStore: store,
		logger:       slog.Default(),
	}

	content := "---\nname: planner\ndescription: Write plans\n---\n"
	_, err := u.Add(ctx, &domain.TeamUser{
		User: &domain.User{ID: userID},
		Team: &domain.Team{ID: teamID},
	}, &domain.AddTeamSkillReq{
		Name:        "planner",
		Description: "Write plans",
		Content:     content,
		SourceType:  "text",
		SourceLabel: "粘贴文本",
	})
	if err != nil {
		t.Fatal(err)
	}

	if repo.createdReq == nil {
		t.Fatal("repo Create was not called")
	}
	if repo.createdReq.Content != content {
		t.Fatalf("content = %q, want original content", repo.createdReq.Content)
	}
	if !strings.HasPrefix(repo.createdReq.PackageObjectKey, "skills/planner-") || !strings.HasSuffix(repo.createdReq.PackageObjectKey, ".zip") {
		t.Fatalf("package object key = %q", repo.createdReq.PackageObjectKey)
	}
	if !strings.HasPrefix(repo.createdReq.PackageURL, "https://oss.example.com/skills/planner-") || !strings.HasSuffix(repo.createdReq.PackageURL, ".zip") {
		t.Fatalf("package url = %q", repo.createdReq.PackageURL)
	}
	if got := readZipFile(t, store.data, "SKILL.md"); got != content {
		t.Fatalf("uploaded SKILL.md content = %q, want %q", got, content)
	}
}

func TestTeamSkillUsecaseAddPackageUploadsOriginalZipAndKeepsContent(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &teamSkillRepoStub{}
	store := &skillPackageStoreStub{}
	u := &teamSkillUsecase{
		repo:         repo,
		packageStore: store,
		logger:       slog.Default(),
	}

	content := "---\nname: packaged\ndescription: Packaged skill\n---\n"
	zipData := makeSkillZip(t, content, "references/guide.md", "guide")
	_, err := u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: userID},
		Team: &domain.Team{ID: teamID},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{
			Name:        "packaged",
			Description: "Packaged skill",
			Content:     content,
			SourceType:  "zip",
			SourceLabel: "packaged.zip",
		},
		PackageFilename: "packaged.zip",
		PackageData:     zipData,
	})
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(store.data, zipData) {
		t.Fatal("uploaded data is not the original zip package")
	}
	if repo.createdReq.Content != content {
		t.Fatalf("content = %q, want original SKILL.md content", repo.createdReq.Content)
	}
	if got := readZipFile(t, store.data, "references/guide.md"); got != "guide" {
		t.Fatalf("zip reference file = %q, want guide", got)
	}
}

type teamSkillRepoStub struct {
	domain.TeamSkillRepo
	createdReq *domain.AddTeamSkillReq
}

func makeSkillZip(t *testing.T, skillContent string, extraName string, extraContent string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{
		"SKILL.md": skillContent,
		extraName:  extraContent,
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (r *teamSkillRepoStub) Create(ctx context.Context, teamID, userID uuid.UUID, req *domain.AddTeamSkillReq) (*db.Skill, error) {
	r.createdReq = req
	return &db.Skill{
		ID:               uuid.New(),
		UserID:           userID,
		Name:             req.Name,
		Description:      req.Description,
		Tags:             req.Tags,
		Content:          req.Content,
		SourceType:       req.SourceType,
		SourceLabel:      req.SourceLabel,
		SkillMdPath:      req.SkillMDPath,
		PackageObjectKey: req.PackageObjectKey,
		PackageURL:       req.PackageURL,
	}, nil
}

type skillPackageStoreStub struct {
	data []byte
}

func (s *skillPackageStoreStub) Put(ctx context.Context, filename string, data []byte) (string, string, error) {
	s.data = append([]byte(nil), data...)
	return "skills/" + filename, "https://oss.example.com/skills/" + filename, nil
}

func readZipFile(t *testing.T, data []byte, name string) string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		defer rc.Close()
		content, err := io.ReadAll(rc)
		if err != nil {
			t.Fatal(err)
		}
		return string(content)
	}
	t.Fatalf("%s not found in zip", name)
	return ""
}
