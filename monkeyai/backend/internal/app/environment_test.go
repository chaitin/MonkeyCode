package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

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
	s := environment.NewService(db).WithRuntime("https://ai.example.com", resource.ID(), identities)
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
	call("GET", "/environment-quota", "", "", 401)
	call("GET", "/environment-quota", legacy, "", 403)
	call("GET", "/environment-quota", manage, "", 403)
	call("POST", "/environments", read, `{}`, 403)
	call("GET", "/environment-quota", read, "", 200)

	host := resource.ID()
	if _, err := db.Exec(ctx, `INSERT INTO engine_hosts(id,name,architecture,version,status,enrollment_hash,enrollment_expires_at,last_seen_at,report)
	 VALUES($1::uuid,'测试宿主','amd64','v1','active',$1::text,now()+interval '1 hour',now(),'{"prerequisites_met":true,"runtime_protocol":1,"network_policies":["public-only"]}')`, host); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(db)
	if err := q.TouchHost(ctx, host); err != nil {
		t.Fatal(err)
	}
	if _, err := q.SetHost(ctx, sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: 8000, MemoryBytes: 16 << 30, StorageBytes: 100 << 30, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	p := environment.Profile{Architecture: "amd64", Image: "example.com/dev@sha256:" + strings.Repeat("a", 64), NetworkPolicy: "public-only",
		Resource: environment.Resources{CPUMillis: 1000, MemoryBytes: 512 << 20, HostTasks: 512, TemporaryBytes: 64 << 20},
		Storage:  environment.Storage{WorkspaceBytes: 1 << 30, HomeBytes: 1 << 30, RuntimeBytes: 1 << 30, Inodes: 10000}}
	raw, _ := json.Marshal(p)
	preset, err := q.CreatePreset(ctx, sqlc.CreatePresetParams{Name: "开发环境", Architecture: p.Architecture, Configuration: raw, CpuMillis: p.Resource.CPUMillis, MemoryBytes: p.Resource.MemoryBytes, StorageBytes: p.Storage.Bytes()})
	if err != nil {
		t.Fatal(err)
	}
	call("GET", "/environment-presets", read, "", 200)
	input := `{"preset_id":"` + preset.ID + `","name":"项目 A","request_key":"client-create"}`
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
	for _, path := range []string{"/environments/" + id, "/environments/" + id + "/operations"} {
		call("GET", path, read, "", 200)
		call("GET", path, other, "", 404)
	}
	var list struct{ Items []environment.View }
	if err := json.Unmarshal(call("GET", "/environments", other, "", 200).Body.Bytes(), &list); err != nil || len(list.Items) != 0 {
		t.Fatal("其他用户看到了环境", err)
	}
	var budget environment.Quota
	if err := json.Unmarshal(call("GET", "/environment-quota?user_id="+users[0], other, "", 200).Body.Bytes(), &budget); err != nil || budget.Usage != (environment.Budget{}) {
		t.Fatal("查询参数改变了额度归属", err)
	}
	if err := json.Unmarshal(call("GET", "/environment-quota", read, "", 200).Body.Bytes(), &budget); err != nil || budget.Usage.Running != 1 || budget.Usage.StorageBytes != 3<<30 {
		t.Fatal("客户端额度未记录创建预留", budget, err)
	}
	change := `{"generation":1,"request_key":"client-stop"}`
	call("POST", "/environments/"+id+"/stop", other, change, 404)
	call("POST", "/environments/"+id+"/start", other, change, 404)
	call("DELETE", "/environments/"+id, other, change, 404)
	call("POST", "/environments/"+id+"/stop", manage, change, 202)
	call("POST", "/environments/"+id+"/stop", manage, change, 202)
	call("DELETE", "/environments/"+id, manage, `{"generation":1,"request_key":"stale-delete"}`, 409)
	call("DELETE", "/environments/"+id, manage, `{"generation":2,"request_key":"client-delete"}`, 202)
}
