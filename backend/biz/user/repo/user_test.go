package repo

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
)

func TestPasswordLoginRejectsSubAccountWhenOIDCDisablesPassword(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_password_oidc?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	teamID := uuid.New()
	userID := uuid.New()
	hashed, err := crypto.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Team.Create().SetID(teamID).SetName("研发团队").SetMemberLimit(10).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.User.Create().SetID(userID).SetName("成员").SetEmail("member@example.com").SetPassword(hashed).SetRole(consts.UserRoleSubAccount).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().SetID(uuid.New()).SetTeamID(teamID).SetUserID(userID).SetRole(consts.TeamMemberRoleUser).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamOIDCConfig.Create().SetID(uuid.New()).SetTeamID(teamID).SetEnabled(true).SetDisplayName("企业登录").SetIssuer("https://id.example.com").SetClientID("client").SetAllowPasswordLogin(false).Save(ctx); err != nil {
		t.Fatal(err)
	}

	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	_, err = repo.PasswordLogin(ctx, &domain.TeamLoginReq{Email: "member@example.com", Password: "secret"})
	if err == nil {
		t.Fatal("expected password login disabled error")
	}
	if err != errcode.ErrPasswordLoginDisabled {
		t.Fatalf("error = %v, want ErrPasswordLoginDisabled", err)
	}
}
