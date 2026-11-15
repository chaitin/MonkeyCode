package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type clientEnvironmentImages struct{}

func (clientEnvironmentImages) Default(ctx context.Context, arch string) (string, string, error) {
	return "example.com/dev@sha256:" + strings.Repeat("a", 64), "sha256:" + strings.Repeat("a", 64), ctx.Err()
}

func TestEnvironmentClientAPI(t *testing.T) {
	db := designAppDatabase(t)
	ctx := t.Context()
	users := []string{resource.ID(), resource.ID()}
	for _, user := range users {
		if _, err := db.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'云环境用户',$2)", user, user+"@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	token := func(user string, scopes []string) string {
		t.Helper()
		var grant string
		if err := db.QueryRow(ctx, "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',$2,now()+interval '1 day') RETURNING id", user, scopes).Scan(&grant); err != nil {
			t.Fatal(err)
		}
		raw := resource.ID()
		digest := sha256.Sum256([]byte(raw))
		if _, err := db.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		 VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(digest[:]), "refresh-"+raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	read := token(users[0], []string{"environment:read"})
	manage := token(users[0], []string{"environment:manage"})
	other := token(users[1], []string{"environment:read", "environment:manage"})
	legacy := token(users[0], []string{"device:connect"})
	identities := identity.NewService(db, nil, "https://ai.example.com")
	s := environment.NewService(db).WithBilling(billing.NewService(db)).WithImages(clientEnvironmentImages{}).WithRuntime("https://ai.example.com", resource.ID(), identities)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) { r.Use(identities.RequireAgent); s.RegisterAgent(r) })
	call := func(method, path, credential, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		if credential != "" {
			r.Header.Set("Authorization", "Bearer "+credential)
		}
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s：%d，预期 %d：%s", method, path, w.Code, want, w.Body.String())
		}
		if want < 400 && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("环境响应允许缓存")
		}
		return w
	}
	call("GET", "/environments", "", "", 401)
	call("GET", "/environments", legacy, "", 403)
	call("GET", "/environments", manage, "", 403)
	call("POST", "/environments", read, `{}`, 403)
	call("GET", "/environments", read, "", 200)

	host := resource.ID()
	if _, err := db.Exec(ctx, `INSERT INTO hosts(id,user_id,name,architecture,version,status,last_seen_at,exchange_protocol,environment_synced_at,max_environments,report)
	 VALUES($1,$2,'测试宿主','amd64','v1','active',now(),1,now(),100,'{"prerequisites_met":true,"environment_protocol":2,"runtime_protocol":1,"network_policies":["public-only"],"system":{"cpu":{"logical_cores":8},"memory":{"total_bytes":17179869184}}}')`, host, users[0]); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(db)
	if _, err := q.SetScheduling(ctx, sqlc.SetSchedulingParams{HostID: host, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	p := environment.Profile{Architecture: "amd64", Image: "example.com/dev@sha256:" + strings.Repeat("a", 64), NetworkPolicy: "public-only",
		Resource: environment.Resources{CPUMillis: 1000, MemoryBytes: 512 << 20, HostTasks: 512, TemporaryBytes: 64 << 20},
		Storage:  environment.Storage{WorkspaceBytes: 1 << 30, HomeBytes: 1 << 30, RuntimeBytes: 1 << 30, Inodes: 10000}}
	raw, _ := json.Marshal(p.Resource)
	if _, err := db.Exec(ctx, `INSERT INTO host_environment_configs(host_id,resource,billing) VALUES($2,$1,'{"enabled":true,"cpu_credits_per_core_hour":"1","memory_credits_per_gib_hour":"0"}')`, raw, host); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,all_users,access_level,granted_by_user_id) VALUES('host',$1,$2,false,'read_only',$2)`, host, users[0]); err != nil {
		t.Fatal(err)
	}
	call("GET", "/environment-presets", read, "", 404)
	call("GET", "/environment-quota", read, "", 404)
	var hosts struct{ Items []environment.HostOption }
	if err := json.Unmarshal(call("GET", "/environment-hosts", read, "", 200).Body.Bytes(), &hosts); err != nil || len(hosts.Items) != 1 || hosts.Items[0].ID != host {
		t.Fatalf("未返回已授权宿主：%v", err)
	}
	if err := json.Unmarshal(call("GET", "/environment-hosts", other, "", 200).Body.Bytes(), &hosts); err != nil || len(hosts.Items) != 0 {
		t.Fatalf("宿主目录授权越权：%v", err)
	}
	input := `{"name":"项目 A","request_key":"client-create","host_id":"` + host + `"}`
	call("POST", "/environments", manage, strings.TrimSuffix(input, "}")+` ,"preset_id":"`+resource.ID()+`"}`, 400)
	call("POST", "/environments", manage, strings.TrimSuffix(input, "}")+`,"image":"arbitrary"}`, 400)
	var created environment.Result
	if err := json.Unmarshal(call("POST", "/environments", manage, input, 202).Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	var retry environment.Result
	if err := json.Unmarshal(call("POST", "/environments", manage, input, 202).Body.Bytes(), &retry); err != nil {
		t.Fatal(err)
	}
	if retry.Environment.ID != created.Environment.ID || retry.Operation.ID != created.Operation.ID {
		t.Fatal("客户端重试创建了新环境")
	}
	call("POST", "/environments", manage, strings.Replace(input, "项目 A", "项目 B", 1), 409)
	id := created.Environment.ID
	var billed environment.View
	if err := json.Unmarshal(call("GET", "/environments/"+id, read, "", 200).Body.Bytes(), &billed); err != nil || billed.Billing == nil || !billed.Billing.Enabled || billed.Billing.Budget == nil || billed.Billing.Budget.Balance.String() != "10000" || billed.Billing.HourlyCredits.String() != "1" {
		t.Fatalf("所属用户未收到真实计费预算：%v %+v", err, billed.Billing)
	}
	for _, path := range []string{"/environments/" + id, "/environments/" + id + "/operations"} {
		call("GET", path, read, "", 200)
		call("GET", path, other, "", 404)
	}
	var list struct{ Items []environment.View }
	if err := json.Unmarshal(call("GET", "/environments", other, "", 200).Body.Bytes(), &list); err != nil || len(list.Items) != 0 {
		t.Fatal("其他用户看到了环境", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM resource_access_grants WHERE resource_type='host' AND resource_id=$1`, host); err != nil {
		t.Fatal(err)
	}
	call("GET", "/environments/"+id, read, "", 200)
	call("POST", "/environments", manage, `{"name":"已撤回","request_key":"revoked-create","host_id":"`+host+`"}`, 403)
	if err := json.Unmarshal(call("GET", "/environment-hosts", read, "", 200).Body.Bytes(), &hosts); err != nil || len(hosts.Items) != 0 {
		t.Fatalf("撤回后目录仍显示宿主：%v", err)
	}
	change := `{"generation":1,"request_key":"client-stop"}`
	call("POST", "/environments/"+id+"/stop", other, change, 404)
	call("POST", "/environments/"+id+"/start", other, change, 404)
	call("DELETE", "/environments/"+id, other, change, 404)
	call("POST", "/environments/"+id+"/stop", manage, change, 202)
	call("POST", "/environments/"+id+"/stop", manage, change, 202)
	call("DELETE", "/environments/"+id, manage, `{"generation":1,"request_key":"stale-delete"}`, 409)
	call("DELETE", "/environments/"+id, manage, `{"generation":2,"request_key":"client-delete"}`, 202)
	if _, err := db.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,all_users,access_level,granted_by_user_id) VALUES('host',$1,$2,false,'read_only',$2)`, host, users[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE credit_accounts SET balance=0 WHERE user_id=$1", users[0]); err != nil {
		t.Fatal(err)
	}
	call("POST", "/environments", manage, `{"name":"余额不足","request_key":"client-unfunded"}`, 402)
}
