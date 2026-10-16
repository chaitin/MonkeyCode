package endpoint

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"sync"
	"testing"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func executionPrincipal(t *testing.T, pool *pgxpool.Pool, userID string, scopes []string) identity.Principal {
	t.Helper()
	p := identity.Principal{UserID: userID, ClientID: "monkeyai-desktop", Audience: identity.Audience, Purpose: "user", Scopes: scopes, RevocationVersion: 1}
	if err := pool.QueryRow(t.Context(), `INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at)
		VALUES($1,$2,$3,now()+interval '1 day') RETURNING id`, userID, p.ClientID, scopes).Scan(&p.GrantID); err != nil {
		t.Fatal(err)
	}
	return p
}

func testEnrollment(t *testing.T) Enrollment {
	t.Helper()
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return Enrollment{MachineID: uuid.New().String(), PublicKey: public, DisplayName: "执行设备", Platform: "macos", Arch: "arm64", Intent: "bind_identity"}
}

func requireExecutionError(t *testing.T, err error, code string) {
	t.Helper()
	var fault *resource.Error
	if !errors.As(err, &fault) || fault.Code != code {
		t.Fatalf("错误=%v want=%s", err, code)
	}
}

func TestExecutionBindingPublicationAndRestore(t *testing.T) {
	pool := testDatabase(t)
	userID := testUser(t, pool, "execution-owner")
	ids := identity.NewService(pool, nil, "http://localhost")
	execution := NewExecution(pool, ids)
	p := executionPrincipal(t, pool, userID, []string{"device:bind", "device:publish", "session:report"})
	manager := executionPrincipal(t, pool, userID, []string{"device:manage"})
	in := testEnrollment(t)
	bound, err := execution.Enroll(t.Context(), p, in, 0)
	if err != nil {
		t.Fatal(err)
	}
	if bound.RemoteAccessState != "disabled" || bound.RegistrationVersion != 1 || bound.GrantVersion != 0 || bound.LeaseEpoch != 0 || bound.DeploymentMode != "" {
		t.Fatalf("只认证不应发布：%+v", bound)
	}
	var machine, keyID string
	if err := pool.QueryRow(t.Context(), "SELECT machine_id,key_id FROM oauth_grants WHERE id=$1", p.GrantID).Scan(&machine, &keyID); err != nil || machine != in.MachineID || keyID != KeyID(in.PublicKey) {
		t.Fatalf("授权绑定异常：%v", err)
	}
	in.Intent, in.DeploymentMode = "publish", "desktop_managed"
	published, err := execution.Enroll(t.Context(), p, in, bound.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if published.GrantVersion != 1 || published.LeaseEpoch != 1 || published.ActiveGrantID != p.GrantID {
		t.Fatalf("发布版本错误：%+v", published)
	}
	reconnected, err := execution.Enroll(t.Context(), p, in, published.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if reconnected.GrantVersion != published.GrantVersion || reconnected.LeaseEpoch != published.LeaseEpoch+1 {
		t.Fatal("重连不应失效全部 ticket")
	}
	revoked, err := execution.Revoke(t.Context(), manager, in.MachineID, published.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	again, err := execution.Revoke(t.Context(), manager, in.MachineID, published.RegistrationVersion)
	if err != nil || again.GrantVersion != revoked.GrantVersion || again.RegistrationVersion != revoked.RegistrationVersion {
		t.Fatalf("撤销不幂等：%v", err)
	}
	_, err = execution.Enroll(t.Context(), p, in, published.RegistrationVersion)
	requireExecutionError(t, err, "device_registration_changed")
	_, err = execution.Enroll(t.Context(), p, in, revoked.RegistrationVersion)
	requireExecutionError(t, err, "device_revoked")
	newLogin := executionPrincipal(t, pool, userID, p.Scopes)
	in.Intent = "bind_identity"
	identityOnly, err := execution.Enroll(t.Context(), newLogin, in, revoked.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if identityOnly.RemoteAccessState != "revoked" || identityOnly.GrantVersion != revoked.GrantVersion || identityOnly.ActiveGrantID != p.GrantID || identityOnly.LeaseEpoch != revoked.LeaseEpoch {
		t.Fatal("重登录不能恢复远程入口或替换活动授权")
	}
	in.Intent, in.RestoreRevoked = "publish", true
	restored, err := execution.Enroll(t.Context(), newLogin, in, identityOnly.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if restored.RemoteAccessState != "enabled" || restored.GrantVersion != revoked.GrantVersion+1 || restored.ActiveGrantID != newLogin.GrantID {
		t.Fatalf("显式恢复错误：%+v", restored)
	}
	valid, err := ids.VerifyGrant(t.Context(), p)
	if err != nil || !valid {
		t.Fatalf("关闭托管访问不应撤销本机授权：%t %v", valid, err)
	}
}

func TestExecutionConflictsAndTransactionRollback(t *testing.T) {
	pool := testDatabase(t)
	owner := testUser(t, pool, "execution-conflict")
	ids := identity.NewService(pool, nil, "http://localhost")
	execution := NewExecution(pool, ids)
	p := executionPrincipal(t, pool, owner, []string{"device:bind"})
	in := testEnrollment(t)
	bound, err := execution.Enroll(t.Context(), p, in, 0)
	if err != nil {
		t.Fatal(err)
	}
	other := testEnrollment(t)
	_, err = execution.Enroll(t.Context(), p, other, 0)
	requireExecutionError(t, err, "device_registration_conflict")
	_, err = execution.State(t.Context(), owner, other.MachineID)
	requireExecutionError(t, err, "device_not_found")
	other.MachineID = in.MachineID
	freshGrant := executionPrincipal(t, pool, owner, []string{"device:bind"})
	_, err = execution.Enroll(t.Context(), freshGrant, other, bound.RegistrationVersion)
	requireExecutionError(t, err, "device_registration_conflict")
	var machine *string
	if err := pool.QueryRow(t.Context(), "SELECT machine_id FROM oauth_grants WHERE id=$1", freshGrant.GrantID).Scan(&machine); err != nil || machine != nil {
		t.Fatalf("失败证明不应留下授权绑定：%v", err)
	}
	otherUser := testUser(t, pool, "execution-other")
	otherManager := executionPrincipal(t, pool, otherUser, []string{"device:manage"})
	_, err = execution.Revoke(t.Context(), otherManager, in.MachineID, bound.RegistrationVersion)
	requireExecutionError(t, err, "device_not_found")
}

func TestExecutionConcurrentRegistration(t *testing.T) {
	pool := testDatabase(t)
	userID := testUser(t, pool, "execution-concurrent")
	ids := identity.NewService(pool, nil, "http://localhost")
	execution := NewExecution(pool, ids)
	in := testEnrollment(t)
	principals := []identity.Principal{
		executionPrincipal(t, pool, userID, []string{"device:bind"}),
		executionPrincipal(t, pool, userID, []string{"device:bind"}),
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, p := range principals {
		wg.Go(func() { _, err := execution.Enroll(t.Context(), p, in, 0); results <- err })
	}
	wg.Wait()
	first, second := <-results, <-results
	if first == nil && second == nil || first != nil && second != nil {
		t.Fatalf("并发登记成功数异常：%v %v", first, second)
	}
	if first != nil {
		requireExecutionError(t, first, "device_registration_changed")
	} else {
		requireExecutionError(t, second, "device_registration_changed")
	}
	state, err := execution.State(t.Context(), userID, in.MachineID)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range principals {
		if _, err := execution.Enroll(t.Context(), p, in, state.RegistrationVersion); err != nil {
			t.Fatal("ready 丢失或并发后应能以新版本恢复：", err)
		}
	}
}

func runtimeExecutionPrincipal(t *testing.T, pool *pgxpool.Pool, user string, in Enrollment, restore bool) identity.Principal {
	t.Helper()
	p := identity.Principal{UserID: user, ClientID: identity.RuntimeClientID, Scopes: []string{"device:bind", "device:publish", "session:report"}, Audience: identity.Audience, Purpose: "runtime", RevocationVersion: 1}
	if err := pool.QueryRow(t.Context(), `INSERT INTO oauth_grants(user_id,client_id,scopes,purpose,requested_machine_id,requested_key_id,restore_approved,expires_at)
	VALUES($1,'monkeyai-runtime',$2,'runtime',$3,$4,$5,now()+interval '1 day') RETURNING id`, user, p.Scopes, in.MachineID, KeyID(in.PublicKey), restore).Scan(&p.GrantID); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestStandaloneTakeoverPreservesHostAndRevokesOnlyExecutionGrant(t *testing.T) {
	pool := testDatabase(t)
	user := testUser(t, pool, "takeover-host")
	ids := identity.NewService(pool, nil, "http://localhost")
	execution := NewExecution(pool, ids)
	host := executionPrincipal(t, pool, user, []string{"device:bind", "device:publish", "session:report"})
	in := testEnrollment(t)
	in.Intent = "publish"
	in.DeploymentMode = "desktop_managed"
	managed, err := execution.Enroll(t.Context(), host, in, 0)
	if err != nil {
		t.Fatal(err)
	}
	session := uuid.New().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO sessions(id,owner_user_id,device_id,title,session_type,client_type,client_name,started_at,host_verified)
	VALUES($1,$2,$3,'原会话','conversation','desktop','测试',now(),true)`, session, user, in.MachineID); err != nil {
		t.Fatal(err)
	}
	runtime := runtimeExecutionPrincipal(t, pool, user, in, false)
	in.DeploymentMode = "standalone"
	standalone, err := execution.Enroll(t.Context(), runtime, in, managed.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if standalone.MachineID != managed.MachineID || standalone.ActiveGrantID != runtime.GrantID || standalone.DeploymentMode != "standalone" || standalone.GrantVersion != managed.GrantVersion+1 {
		t.Fatal("独立接管改变设备或没有切换授权")
	}
	var device string
	if err = pool.QueryRow(t.Context(), "SELECT device_id FROM sessions WHERE id=$1", session).Scan(&device); err != nil || device != in.MachineID {
		t.Fatal("接管改变了原会话宿主")
	}
	if valid, err := ids.VerifyGrant(t.Context(), host); err != nil || !valid {
		t.Fatal("接管撤销了 Desktop 自身登录")
	}
	reauthorized := runtimeExecutionPrincipal(t, pool, user, in, false)
	current, err := execution.Enroll(t.Context(), reauthorized, in, standalone.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if current.ActiveGrantID != reauthorized.GrantID {
		t.Fatal("新的独立授权没有成为活动执行授权")
	}
	if valid, err := ids.VerifyGrant(t.Context(), runtime); err != nil || valid {
		t.Fatal("重授权没有撤销原专用执行授权")
	}
	manager := executionPrincipal(t, pool, user, []string{"device:manage"})
	revoked, err := execution.Revoke(t.Context(), manager, in.MachineID, current.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if valid, err := ids.VerifyGrant(t.Context(), reauthorized); err != nil || valid {
		t.Fatal("移除独立设备没有撤销执行授权")
	}
	if valid, err := ids.VerifyGrant(t.Context(), host); err != nil || !valid {
		t.Fatal("移除独立设备影响了 Desktop 登录")
	}
	unapproved := runtimeExecutionPrincipal(t, pool, user, in, false)
	in.RestoreRevoked = true
	_, err = execution.Enroll(t.Context(), unapproved, in, revoked.RegistrationVersion)
	requireExecutionError(t, err, "device_revoked")
	approved := runtimeExecutionPrincipal(t, pool, user, in, true)
	if _, err = execution.Enroll(t.Context(), approved, in, revoked.RegistrationVersion); err != nil {
		t.Fatal(err)
	}
	var restore bool
	if err = pool.QueryRow(t.Context(), "SELECT restore_approved FROM oauth_grants WHERE id=$1", approved.GrantID).Scan(&restore); err != nil || restore {
		t.Fatal("恢复批准未被单次消费")
	}
}

func TestExecutionHostAuthenticationAfterRemoteRevocation(t *testing.T) {
	pool := testDatabase(t)
	userID := testUser(t, pool, "execution-report")
	ids := identity.NewService(pool, nil, "http://localhost")
	execution := NewExecution(pool, ids)
	p := executionPrincipal(t, pool, userID, []string{"device:bind", "session:report"})
	legacy := executionPrincipal(t, pool, userID, []string{})
	in := testEnrollment(t)
	bound, err := execution.Enroll(t.Context(), p, in, 0)
	if err != nil {
		t.Fatal(err)
	}
	p.MachineID, p.KeyID = in.MachineID, bound.KeyID
	manager := executionPrincipal(t, pool, userID, []string{"device:manage"})
	if _, err := execution.Revoke(t.Context(), manager, in.MachineID, bound.RegistrationVersion); err != nil {
		t.Fatal(err)
	}
	authenticate := func(p identity.Principal) (bool, error) {
		tx, err := pool.Begin(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(context.WithoutCancel(t.Context()))
		return execution.AuthenticateHost(t.Context(), tx, p, in.MachineID)
	}
	valid, err := authenticate(p)
	if err != nil || !valid {
		t.Fatalf("关闭远程后认证宿主仍应可补传：%t %v", valid, err)
	}
	_, err = authenticate(legacy)
	var fault *resource.Error
	if !errors.As(err, &fault) || fault.Status != http.StatusForbidden || fault.Code != "device_identity_required" {
		t.Fatalf("旧身份不应降级写入已验证设备：%v", err)
	}
	if err := ids.RevokeGrant(t.Context(), p.GrantID, "test"); err != nil {
		t.Fatal(err)
	}
	_, err = authenticate(p)
	requireExecutionError(t, err, "permission_denied")
}
