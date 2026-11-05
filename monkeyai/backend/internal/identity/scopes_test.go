package identity

import (
	"net/http"
	"os"
	"testing"
)

func TestEnvironmentScopesRollbackDoesNotRestoreCredentials(t *testing.T) {
	db := emailDatabase(t)
	s := NewService(db, nil, "https://ai.example.com")
	user := grantUser(t, s)
	cloud := grantToken(t, s, user.ID, "environment:read environment:manage device:connect")
	legacy := grantToken(t, s, user.ID, "device:connect")
	pending, _ := grantRequest(t, s, "environment:manage")
	var revoked string
	for _, direction := range []string{"down", "down", "up", "up", "down", "up"} {
		raw, err := os.ReadFile("../../migrations/000038_cloud_environments." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(t.Context(), string(raw)); err != nil {
			t.Fatal(err)
		}
		tokenPrincipal(t, s, cloud.AccessToken, http.StatusUnauthorized)
		tokenPrincipal(t, s, legacy.AccessToken, http.StatusNoContent)
		var state string
		if err := db.QueryRow(t.Context(), `SELECT jsonb_build_array(
(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM oauth_grants g),
(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM oauth_tokens t),
(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM oauth_authorization_requests r))::text`).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if revoked != "" && revoked != state {
			t.Fatal("重复迁移改变了授权撤销版本、凭据或请求过期时间")
		}
		revoked = state
	}
	if _, err := s.Refresh(t.Context(), "monkeyai-desktop", cloud.RefreshToken); err == nil {
		t.Fatal("重新升级恢复了已回滚授权")
	}
	approval := []string{"environment:manage"}
	if _, err := s.completeAuthorization(t.Context(), pending.ID, user.ID, &approval); err == nil {
		t.Fatal("回滚前的未完成申请仍可授权")
	}
	fresh := grantToken(t, s, user.ID, "environment:read")
	if !tokenPrincipal(t, s, fresh.AccessToken, http.StatusNoContent).Has("environment:read") {
		t.Fatal("重新升级后新授权不可用")
	}
}
