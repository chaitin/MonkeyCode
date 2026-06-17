package repo

import (
	"context"
	"fmt"
	"log/slog"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teamextensionimagearchive"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamExtensionPackageRepo struct {
	db     *db.Client
	logger *slog.Logger
}

func NewTeamExtensionPackageRepo(i *do.Injector) (domain.TeamExtensionPackageRepo, error) {
	return &teamExtensionPackageRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (r *teamExtensionPackageRepo) ImportResources(ctx context.Context, teamID, userID uuid.UUID, req *domain.TeamExtensionImport) (*domain.TeamExtensionImportResult, error) {
	result := &domain.TeamExtensionImportResult{}
	// Skill 导入已移到 usecase 层(走 TeamSkillUsecase.Add),这里只处理 images。
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		for _, item := range req.Images {
			if err := r.checkImageNameConflict(ctx, tx, teamID, req.PackageID, item); err != nil {
				return err
			}
			img, created, err := r.upsertImage(ctx, tx, teamID, userID, req, item)
			if err != nil {
				return err
			}
			if created {
				result.CreatedImages++
			} else {
				result.UpdatedImages++
			}
			if err := r.upsertImageArchives(ctx, tx, teamID, req, item, img.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		r.logger.Error("import team extension resources", "error", err)
		return nil, err
	}
	return result, nil
}

func (r *teamExtensionPackageRepo) ListImageArchives(ctx context.Context, teamID uuid.UUID) ([]*db.TeamExtensionImageArchive, error) {
	archives, err := r.db.TeamExtensionImageArchive.Query().
		Where(teamextensionimagearchive.TeamID(teamID)).
		Order(
			teamextensionimagearchive.ByPackageID(sql.OrderAsc()),
			teamextensionimagearchive.ByExtensionImageID(sql.OrderAsc()),
			teamextensionimagearchive.ByArch(sql.OrderAsc()),
		).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	return archives, nil
}

func (r *teamExtensionPackageRepo) checkImageNameConflict(ctx context.Context, tx *db.Tx, teamID uuid.UUID, packageID string, item domain.TeamExtensionImageImport) error {
	conflict, err := tx.Image.Query().
		Where(
			image.HasTeamsWith(team.ID(teamID)),
			image.Name(item.Name),
			image.ExtensionPackageIDNEQ(""),
			image.ExtensionPackageIDNEQ(packageID),
		).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil
		}
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return errcode.ErrBadRequest.Wrap(fmt.Errorf("image %q already imported by extension package %q", item.Name, conflict.ExtensionPackageID))
}

func (r *teamExtensionPackageRepo) upsertImage(ctx context.Context, tx *db.Tx, teamID, userID uuid.UUID, req *domain.TeamExtensionImport, item domain.TeamExtensionImageImport) (*db.Image, bool, error) {
	existing, err := tx.Image.Query().
		Where(
			image.HasTeamsWith(team.ID(teamID)),
			image.ExtensionPackageID(req.PackageID),
			image.ExtensionImageID(item.ImageID),
		).
		Only(ctx)
	if err != nil && !db.IsNotFound(err) {
		return nil, false, errcode.ErrDatabaseQuery.Wrap(err)
	}
	if err == nil {
		if err := tx.Image.UpdateOneID(existing.ID).
			Where(image.HasTeamsWith(team.ID(teamID))).
			SetName(item.Name).
			SetRemark(item.Remark).
			SetExtensionPackageID(req.PackageID).
			SetExtensionImageID(item.ImageID).
			SetExtensionVersion(req.Version).
			Exec(ctx); err != nil {
			return nil, false, errcode.ErrDatabaseOperation.Wrap(err)
		}
		existing.Name = item.Name
		existing.Remark = item.Remark
		existing.ExtensionVersion = req.Version
		return existing, false, nil
	}

	img, err := tx.Image.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetName(item.Name).
		SetRemark(item.Remark).
		SetExtensionPackageID(req.PackageID).
		SetExtensionImageID(item.ImageID).
		SetExtensionVersion(req.Version).
		Save(ctx)
	if err != nil {
		return nil, false, errcode.ErrDatabaseOperation.Wrap(err)
	}
	if err := tx.TeamImage.Create().
		SetID(uuid.New()).
		SetImageID(img.ID).
		SetTeamID(teamID).
		Exec(ctx); err != nil {
		return nil, false, errcode.ErrDatabaseOperation.Wrap(err)
	}
	groupIDs, err := ensureDefaultGroupIDs(ctx, tx, teamID, nil)
	if err != nil {
		return nil, false, errcode.ErrDatabaseQuery.Wrap(err)
	}
	builders := make([]*db.TeamGroupImageCreate, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		builders = append(builders, tx.TeamGroupImage.Create().
			SetID(uuid.New()).
			SetGroupID(groupID).
			SetImageID(img.ID))
	}
	if len(builders) > 0 {
		if _, err := tx.TeamGroupImage.CreateBulk(builders...).Save(ctx); err != nil {
			return nil, false, errcode.ErrDatabaseOperation.Wrap(err)
		}
	}
	return img, true, nil
}

func (r *teamExtensionPackageRepo) upsertImageArchives(ctx context.Context, tx *db.Tx, teamID uuid.UUID, req *domain.TeamExtensionImport, item domain.TeamExtensionImageImport, imageID uuid.UUID) error {
	for _, archive := range item.Archives {
		existing, err := tx.TeamExtensionImageArchive.Query().
			Where(
				teamextensionimagearchive.TeamID(teamID),
				teamextensionimagearchive.PackageID(req.PackageID),
				teamextensionimagearchive.ExtensionImageID(item.ImageID),
				teamextensionimagearchive.Arch(archive.Arch),
			).
			Only(ctx)
		if err != nil && !db.IsNotFound(err) {
			return errcode.ErrDatabaseQuery.Wrap(err)
		}
		if err == nil {
			if err := tx.TeamExtensionImageArchive.UpdateOneID(existing.ID).
				SetImageID(imageID).
				SetVersion(req.Version).
				SetImageName(item.Name).
				SetArchivePath(archive.ArchivePath).
				SetArchiveURL(archive.ArchiveURL).
				SetSha256(archive.SHA256).
				Exec(ctx); err != nil {
				return errcode.ErrDatabaseOperation.Wrap(err)
			}
			continue
		}
		if err := tx.TeamExtensionImageArchive.Create().
			SetID(uuid.New()).
			SetTeamID(teamID).
			SetImageID(imageID).
			SetPackageID(req.PackageID).
			SetExtensionImageID(item.ImageID).
			SetVersion(req.Version).
			SetArch(archive.Arch).
			SetImageName(item.Name).
			SetArchivePath(archive.ArchivePath).
			SetArchiveURL(archive.ArchiveURL).
			SetSha256(archive.SHA256).
			Exec(ctx); err != nil {
			return errcode.ErrDatabaseOperation.Wrap(err)
		}
	}
	return nil
}
