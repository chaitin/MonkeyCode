package usecase

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/oss"
)

const skillPackagePrefix = "skills"

type teamSkillUsecase struct {
	repo         domain.TeamSkillRepo
	packageStore skillPackageStore
	logger       *slog.Logger
}

func NewTeamSkillUsecase(i *do.Injector) (domain.TeamSkillUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	var store skillPackageStore
	if cfg.ObjectStorage.Enabled {
		client, err := oss.NewS3Compatible(context.Background(), cfg.ObjectStorage, oss.S3Option{
			ForcePathStyle: cfg.ObjectStorage.ForcePathStyle,
			InitBucket:     cfg.ObjectStorage.InitBucket,
		})
		if err != nil {
			return nil, err
		}
		store = &ossSkillPackageStore{client: client.WithAccessEndpoint(cfg.ObjectStorage.AccessEndpoint)}
	}
	return &teamSkillUsecase{
		repo:         do.MustInvoke[domain.TeamSkillRepo](i),
		packageStore: store,
		logger:       do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamSkillUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillReq) (*domain.TeamSkill, error) {
	if req.PackageObjectKey == "" {
		if u.packageStore == nil {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
		}
		data, err := packageSkillMarkdownContent(req.Content)
		if err != nil {
			return nil, err
		}
		objectKey, url, err := u.packageStore.Put(ctx, skillPackageFilename(req.Name), data)
		if err != nil {
			return nil, err
		}
		req.PackageObjectKey = objectKey
		req.PackageURL = url
	}

	skill, err := u.repo.Create(ctx, teamUser.GetTeamID(), teamUser.User.ID, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(skill, &domain.TeamSkill{}), nil
}

func (u *teamSkillUsecase) AddPackage(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillPackageReq) (*domain.TeamSkill, error) {
	if u.packageStore == nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
	}
	if err := validateSkillZipPackage(req.PackageData); err != nil {
		return nil, err
	}
	filename := skillPackageFilename(req.PackageFilename)
	if strings.TrimSpace(req.Name) != "" {
		filename = skillPackageFilename(req.Name)
	}
	objectKey, url, err := u.packageStore.Put(ctx, filename, req.PackageData)
	if err != nil {
		return nil, err
	}
	req.PackageObjectKey = objectKey
	req.PackageURL = url
	return u.Add(ctx, teamUser, &req.AddTeamSkillReq)
}

func (u *teamSkillUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamSkillsResp, error) {
	skills, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	return &domain.ListTeamSkillsResp{
		Skills: cvt.Iter(skills, func(_ int, skill *db.Skill) *domain.TeamSkill {
			return cvt.From(skill, &domain.TeamSkill{})
		}),
	}, nil
}

func (u *teamSkillUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamSkillReq) (*domain.TeamSkill, error) {
	skill, err := u.repo.Update(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	return cvt.From(skill, &domain.TeamSkill{}), nil
}

func (u *teamSkillUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamSkillReq) error {
	return u.repo.Delete(ctx, teamUser.GetTeamID(), req.SkillID)
}

type skillPackageStore interface {
	Put(ctx context.Context, filename string, data []byte) (objectKey string, url string, err error)
}

type ossSkillPackageStore struct {
	client *oss.Client
}

func (s *ossSkillPackageStore) Put(ctx context.Context, filename string, data []byte) (string, string, error) {
	if s == nil || s.client == nil {
		return "", "", errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
	}
	if err := s.client.PutFile(ctx, skillPackagePrefix, filename, bytes.NewReader(data)); err != nil {
		return "", "", err
	}
	objectKey := strings.Trim(filepath.ToSlash(filepath.Join(skillPackagePrefix, filepath.Base(filename))), "/")
	return objectKey, s.client.GetURL(skillPackagePrefix, filename), nil
}

func packageSkillMarkdownContent(content string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("SKILL.md")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write([]byte(content)); err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func validateSkillZipPackage(data []byte) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid skill zip package"))
	}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Base(file.Name), "SKILL.md") {
			return nil
		}
	}
	return errcode.ErrBadRequest.Wrap(fmt.Errorf("zip package missing SKILL.md"))
}

func skillPackageFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "skill"
	} else if ext := filepath.Ext(name); strings.EqualFold(ext, ".zip") {
		name = strings.TrimSuffix(name, ext)
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "-")
	name = strings.Trim(replacer.Replace(name), ".-")
	if name == "" {
		name = "skill"
	}
	return fmt.Sprintf("%s-%s.zip", name, uuid.NewString())
}
