package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type clientRuntimeCatalog struct{}

func (clientRuntimeCatalog) Current(arch string) (environment.RuntimePackage, error) {
	return clientRuntimeCatalog{}.Get("26.1105.2", arch)
}
func (clientRuntimeCatalog) Get(version, arch string) (environment.RuntimePackage, error) {
	if version != "26.1105.2" || arch != "amd64" {
		return environment.RuntimePackage{}, fmt.Errorf("missing release")
	}
	files := map[string]environment.RuntimeFile{}
	for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
		files[name] = environment.RuntimeFile{SHA256: strings.Repeat("a", 64), Size: 1}
	}
	return environment.RuntimePackage{Version: version, Architecture: arch, Files: files}, nil
}
func TestEnvironmentRuntimeClientAPI(t *testing.T) {
	pool := designAppDatabase(t)
	user, other, host := resource.ID(), resource.ID(), resource.ID()
	for _, id := range []string{user, other} {
		if _, err := pool.Exec(t.Context(), "INSERT INTO users(id,name,email) VALUES($1,'runtime用户',$2)", id, id+"@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	token := func(id string, scopes []string) string {
		var grant string
		if err := pool.QueryRow(t.Context(), "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',$2,now()+interval '1 day') RETURNING id", id, scopes).Scan(&grant); err != nil {
			t.Fatal(err)
		}
		value := resource.ID()
		digest := sha256.Sum256([]byte(value))
		if _, err := pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, id, grant, hex.EncodeToString(digest[:]), "refresh-"+value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	read := token(user, []string{"environment:read"})
	manage := token(user, []string{"environment:manage"})
	foreign := token(other, []string{"environment:read", "environment:manage"})
	identities := identity.NewService(pool, nil, "https://server.example")
	service := environment.NewService(pool).WithImages(clientEnvironmentImages{}).WithRuntime("https://server.example", resource.ID(), identities).WithRuntimeCatalog(clientRuntimeCatalog{})
	if _, err := pool.Exec(t.Context(), `INSERT INTO hosts(id,user_id,name,architecture,version,status,last_seen_at,exchange_protocol,environment_synced_at,max_environments,report) VALUES($1,$2,'runtime宿主','amd64','v2','active',now(),1,now()-interval '30 seconds',100,'{"prerequisites_met":true,"runtime_protocol":1,"environment_protocol":2,"runtime_update_protocol":1,"network_policies":["public-only"],"system":{"cpu":{"logical_cores":8},"memory":{"total_bytes":17179869184}}}')`, host, user); err != nil {
		t.Fatal(err)
	}
	query := sqlc.New(pool)
	if _, err := query.SetScheduling(t.Context(), sqlc.SetSchedulingParams{HostID: host, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	profile := environment.Profile{Architecture: "amd64", Image: "example.com/environment@sha256:" + strings.Repeat("a", 64), NetworkPolicy: "public-only", Resource: environment.Resources{CPUMillis: 1000, MemoryBytes: 512 << 20, HostTasks: 512, TemporaryBytes: 64 << 20}}
	raw, _ := json.Marshal(profile.Resource)
	if _, err := pool.Exec(t.Context(), "INSERT INTO host_environment_configs(host_id,resource) VALUES($2,$1)", raw, host); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO resource_access_grants(resource_type,resource_id,all_users,access_level,granted_by_user_id) VALUES('host',$1,true,'read_only',$2)`, host, user); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) { r.Use(identities.RequireAgent); service.RegisterAgent(r) })
	call := func(method, path, credential, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if credential != "" {
			request.Header.Set("Authorization", "Bearer "+credential)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("%s %s: %d，预期%d：%s", method, path, response.Code, status, response.Body.String())
		}
		return response
	}
	var created environment.Result
	if err := json.Unmarshal(call("POST", "/environments", manage, `{"name":"runtime客户端","request_key":"create-runtime-client"}`, 202).Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Environment.RuntimeVersion != "" {
		t.Fatal("未上报时不应使用server发行版本", created.Environment.RuntimeVersion)
	}
	base := "/environments/" + created.Environment.ID
	call("GET", base+"/runtime", "", "", 401)
	call("GET", base+"/runtime", foreign, "", 404)
	call("GET", base+"/runtime", manage, "", 403)
	call("POST", base+"/runtime/upgrade", read, `{}`, 403)
	call("POST", base+"/runtime/upgrade", manage, `{"generation":1,"request_key":"must-stop"}`, 409)
	var stopped environment.Result
	json.Unmarshal(call("POST", base+"/stop", manage, `{"generation":1,"request_key":"stop-runtime-client"}`, 202).Body.Bytes(), &stopped)
	observation := environment.Observation{EnvironmentID: created.Environment.ID, InstanceID: created.Environment.InstanceID, Generation: stopped.Environment.Generation, Phase: "stopped", RuntimeVersion: "26.1105.1"}
	raw, _ = json.Marshal(environment.Exchange{Protocol: 1, Results: []environment.Observation{observation}})
	if _, err := service.Exchange(t.Context(), host, raw); err != nil {
		t.Fatal(err)
	}
	var info environment.RuntimeInfo
	json.Unmarshal(call("GET", base+"/runtime", read, "", 200).Body.Bytes(), &info)
	if !info.CanUpdate || !info.UpdateAvailable || info.CurrentVersion != "26.1105.1" || info.LatestVersion != "26.1105.2" {
		t.Fatal(info)
	}
	input := `{"generation":2,"request_key":"upgrade-runtime-client"}`
	call("POST", base+"/runtime/upgrade", foreign, input, 404)
	call("POST", base+"/runtime/upgrade", manage, `{"generation":2,"request_key":"bad-url","url":"https://untrusted.example/runtime"}`, 400)
	var upgraded, retry environment.Result
	json.Unmarshal(call("POST", base+"/runtime/upgrade", manage, input, 202).Body.Bytes(), &upgraded)
	json.Unmarshal(call("POST", base+"/runtime/upgrade", manage, input, 202).Body.Bytes(), &retry)
	if upgraded.Operation.ID != retry.Operation.ID || upgraded.Environment.InstanceID != created.Environment.InstanceID || upgraded.Operation.Kind != "runtime_upgrade" {
		t.Fatal(upgraded, retry)
	}
	observation.Generation, observation.RuntimeVersion = upgraded.Environment.Generation, "26.1105.2"
	raw, _ = json.Marshal(environment.Exchange{Protocol: 1, Results: []environment.Observation{observation}})
	if _, err := service.Exchange(t.Context(), host, raw); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(call("GET", base+"/runtime", read, "", 200).Body.Bytes(), &info)
	if info.CurrentVersion != "26.1105.2" || info.UpdateAvailable || info.Operation == nil || info.Operation.Status != "succeeded" {
		t.Fatal(info)
	}
	var detail environment.View
	if err := json.Unmarshal(call("GET", base, read, "", 200).Body.Bytes(), &detail); err != nil || detail.RuntimeVersion != "26.1105.2" {
		t.Fatal("详情未返回实际runtime版本", detail.RuntimeVersion, err)
	}
	var list struct {
		Items []environment.View `json:"items"`
	}
	if err := json.Unmarshal(call("GET", "/environments", read, "", 200).Body.Bytes(), &list); err != nil || len(list.Items) != 1 || list.Items[0].RuntimeVersion != "26.1105.2" {
		t.Fatal("列表未返回实际runtime版本", list, err)
	}
}
