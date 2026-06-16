package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type TeamExtensionPackageUsecase interface {
	Import(ctx context.Context, teamUser *TeamUser, req *ImportTeamExtensionPackageReq) (*ImportTeamExtensionPackageResp, error)
}

type TeamExtensionPackageRepo interface {
	ImportResources(ctx context.Context, teamID, userID uuid.UUID, req *TeamExtensionImport) (*TeamExtensionImportResult, error)
	ListImageArchives(ctx context.Context, teamID uuid.UUID) ([]*db.TeamExtensionImageArchive, error)
}

type ImportTeamExtensionPackageReq struct {
	Filename string
	Data     []byte
}

type ImportTeamExtensionPackageResp struct {
	PackageID     string `json:"package_id"`
	Version       string `json:"version"`
	CreatedSkills int    `json:"created_skills"`
	UpdatedSkills int    `json:"updated_skills"`
	CreatedImages int    `json:"created_images"`
	UpdatedImages int    `json:"updated_images"`
}

type TeamExtensionImport struct {
	PackageID string
	Version   string
	Skills    []TeamExtensionSkillImport
	Images    []TeamExtensionImageImport
}

type TeamExtensionSkillImport struct {
	SkillID          string
	Name             string
	Description      string
	Tags             []string
	Content          string
	Path             string
	PackageObjectKey string
	PackageURL       string
}

type TeamExtensionImageImport struct {
	ImageID  string
	Name     string
	Remark   string
	Archives []TeamExtensionImageArchiveImport
}

type TeamExtensionImageArchiveImport struct {
	Arch        string
	SHA256      string
	ArchivePath string
	ArchiveURL  string
}

type TeamExtensionImportResult struct {
	CreatedSkills int
	UpdatedSkills int
	CreatedImages int
	UpdatedImages int
}
