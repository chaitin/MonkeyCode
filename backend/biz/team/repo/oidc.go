package repo

import (
	"context"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/db/teamoidcconfig"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/useridentity"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/oidc"
)

type TeamOIDCRepo struct {
	db *db.Client
}

func NewTeamOIDCRepo(i *do.Injector) (domain.TeamOIDCRepo, error) {
	return &TeamOIDCRepo{db: do.MustInvoke[*db.Client](i)}, nil
}

func (r *TeamOIDCRepo) GetConfig(ctx context.Context, teamID uuid.UUID) (*db.TeamOIDCConfig, error) {
	return r.db.TeamOIDCConfig.Query().Where(teamoidcconfig.TeamIDEQ(teamID)).First(ctx)
}

func (r *TeamOIDCRepo) GetDefaultEnabledConfig(ctx context.Context) (*db.TeamOIDCConfig, error) {
	return r.db.TeamOIDCConfig.Query().
		Where(teamoidcconfig.EnabledEQ(true)).
		WithTeam().
		Modify(func(s *sql.Selector) {
			t := sql.Table(team.Table)
			s.Join(t).On(s.C(teamoidcconfig.FieldTeamID), t.C(team.FieldID))
			s.OrderBy(t.C(team.FieldCreatedAt), s.C(teamoidcconfig.FieldCreatedAt))
		}).
		First(ctx)
}

func (r *TeamOIDCRepo) UpsertConfig(ctx context.Context, teamID uuid.UUID, req *domain.SaveTeamOIDCConfigReq) (*db.TeamOIDCConfig, error) {
	issuer := oidc.CleanIssuer(req.Issuer)
	scopes := strings.TrimSpace(req.Scopes)
	if scopes == "" {
		scopes = "openid email profile"
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = "企业登录"
	}
	create := r.db.TeamOIDCConfig.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetEnabled(req.Enabled).
		SetDisplayName(displayName).
		SetIssuer(issuer).
		SetClientID(strings.TrimSpace(req.ClientID)).
		SetScopes(scopes).
		SetEmailDomain(strings.TrimSpace(strings.ToLower(req.EmailDomain))).
		SetAutoCreateMember(req.AutoCreateMember).
		SetAllowPasswordLogin(req.AllowPasswordLogin)
	if req.ClientSecret != "" {
		create.SetClientSecretCiphertext(req.ClientSecret)
	}
	id, err := create.
		OnConflictColumns(teamoidcconfig.FieldTeamID).
		Update(func(upsert *db.TeamOIDCConfigUpsert) {
			upsert.SetEnabled(req.Enabled)
			upsert.SetDisplayName(displayName)
			upsert.SetIssuer(issuer)
			upsert.SetClientID(strings.TrimSpace(req.ClientID))
			upsert.SetScopes(scopes)
			upsert.SetEmailDomain(strings.TrimSpace(strings.ToLower(req.EmailDomain)))
			upsert.SetAutoCreateMember(req.AutoCreateMember)
			upsert.SetAllowPasswordLogin(req.AllowPasswordLogin)
			if req.ClientSecret != "" {
				upsert.SetClientSecretCiphertext(req.ClientSecret)
			}
		}).
		ID(ctx)
	if err != nil {
		return nil, err
	}
	return r.db.TeamOIDCConfig.Get(ctx, id)
}

func (r *TeamOIDCRepo) FindUserByOIDCIdentity(ctx context.Context, identityID string) (*db.User, error) {
	identity, err := r.db.UserIdentity.Query().
		Where(useridentity.PlatformEQ(consts.UserPlatformOIDC), useridentity.IdentityIDEQ(identityID)).
		WithUser().
		First(ctx)
	if err != nil {
		return nil, err
	}
	return identity.Edges.User, nil
}

func (r *TeamOIDCRepo) FindTeamMemberByEmail(ctx context.Context, teamID uuid.UUID, email string) (*db.TeamMember, error) {
	return r.db.TeamMember.Query().
		Where(
			teammember.TeamIDEQ(teamID),
			teammember.HasUserWith(user.EmailEQ(normalizeEmail(email))),
		).
		WithUser().
		First(ctx)
}

func (r *TeamOIDCRepo) BindOIDCIdentity(ctx context.Context, userID uuid.UUID, external *domain.OIDCExternalUser) error {
	identityID := oidc.IdentityID(external.Issuer, external.Subject)
	exists, err := r.db.UserIdentity.Query().
		Where(useridentity.PlatformEQ(consts.UserPlatformOIDC), useridentity.IdentityIDEQ(identityID)).
		Exist(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	name := external.Name
	if name == "" {
		name = external.Username
	}
	if name == "" {
		name = external.Email
	}
	return r.db.UserIdentity.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetPlatform(consts.UserPlatformOIDC).
		SetIdentityID(identityID).
		SetUsername(name).
		SetEmail(external.Email).
		SetAvatarURL(external.AvatarURL).
		Exec(ctx)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
