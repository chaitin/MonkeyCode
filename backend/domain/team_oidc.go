package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type TeamOIDCUsecase interface {
	GetConfig(ctx context.Context, teamUser *TeamUser) (*TeamOIDCConfigResp, error)
	SaveConfig(ctx context.Context, teamUser *TeamUser, req *SaveTeamOIDCConfigReq) (*TeamOIDCConfigResp, error)
	TestConfig(ctx context.Context, teamUser *TeamUser, req *SaveTeamOIDCConfigReq) (*TeamOIDCTestResp, error)
}

type TeamOIDCLoginUsecase interface {
	StartLogin(ctx context.Context, teamID uuid.UUID) (string, error)
	HandleCallback(ctx context.Context, req *TeamOIDCCallbackReq) (*User, error)
	PublicConfig(ctx context.Context, teamID uuid.UUID) (*TeamOIDCPublicConfigResp, error)
	DefaultPublicConfig(ctx context.Context) (*TeamOIDCPublicConfigResp, error)
	PasswordLoginAllowed(ctx context.Context, teamID uuid.UUID) (bool, error)
}

type TeamOIDCRepo interface {
	GetConfig(ctx context.Context, teamID uuid.UUID) (*db.TeamOIDCConfig, error)
	GetDefaultEnabledConfig(ctx context.Context) (*db.TeamOIDCConfig, error)
	UpsertConfig(ctx context.Context, teamID uuid.UUID, req *SaveTeamOIDCConfigReq) (*db.TeamOIDCConfig, error)
	FindUserByOIDCIdentity(ctx context.Context, identityID string) (*db.User, error)
	FindTeamMemberByEmail(ctx context.Context, teamID uuid.UUID, email string) (*db.TeamMember, error)
	BindOIDCIdentity(ctx context.Context, userID uuid.UUID, external *OIDCExternalUser) error
	AutoCreateMember(ctx context.Context, teamID uuid.UUID, external *OIDCExternalUser) (*db.User, error)
}

type TeamOIDCConfig struct {
	ID                 uuid.UUID `json:"id"`
	TeamID             uuid.UUID `json:"team_id"`
	Enabled            bool      `json:"enabled"`
	DisplayName        string    `json:"display_name"`
	Issuer             string    `json:"issuer"`
	ClientID           string    `json:"client_id"`
	HasClientSecret    bool      `json:"has_client_secret"`
	Scopes             string    `json:"scopes"`
	EmailDomain        string    `json:"email_domain"`
	AutoCreateMember   bool      `json:"auto_create_member"`
	AllowPasswordLogin bool      `json:"allow_password_login"`
	RedirectURI        string    `json:"redirect_uri"`
	LoginURL           string    `json:"login_url"`
}

type SaveTeamOIDCConfigReq struct {
	Enabled            bool   `json:"enabled"`
	DisplayName        string `json:"display_name" validate:"required"`
	Issuer             string `json:"issuer" validate:"required"`
	ClientID           string `json:"client_id" validate:"required"`
	ClientSecret       string `json:"client_secret"`
	Scopes             string `json:"scopes"`
	EmailDomain        string `json:"email_domain"`
	AutoCreateMember   bool   `json:"auto_create_member"`
	AllowPasswordLogin bool   `json:"allow_password_login"`
}

type TeamOIDCConfigResp struct {
	Config *TeamOIDCConfig `json:"config"`
}

type TeamOIDCTestResp struct {
	Success bool   `json:"success"`
	Issuer  string `json:"issuer"`
	Message string `json:"message"`
}

type TeamOIDCPublicConfigReq struct {
	TeamID uuid.UUID `param:"team_id" validate:"required" json:"-" swaggerignore:"true"`
}

type TeamOIDCPublicConfigResp struct {
	TeamID      uuid.UUID `json:"team_id"`
	Enabled     bool      `json:"enabled"`
	DisplayName string    `json:"display_name"`
	LoginURL    string    `json:"login_url"`
}

type TeamOIDCLoginReq struct {
	TeamID uuid.UUID `query:"team_id" validate:"required"`
}

type TeamOIDCCallbackReq struct {
	Code  string `query:"code" validate:"required"`
	State string `query:"state" validate:"required"`
}

type OIDCExternalUser struct {
	Issuer        string
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Username      string
	AvatarURL     string
}
