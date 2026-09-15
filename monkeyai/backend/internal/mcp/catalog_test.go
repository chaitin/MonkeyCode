package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestIndependentToolsVisibleAfterAuthorization(t *testing.T) {
	for _, method := range []string{"oauth", "http_header"} {
		t.Run(method, func(t *testing.T) {
			f := setup(t)
			f.sql(`UPDATE users SET role='user' WHERE id=$1`, f.users["other"])
			remote := mcpRemote(t, nil)
			oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				resource.JSON(w, 200, resource.Object{"access_token": "oauth-secret", "refresh_token": "refresh-secret", "expires_in": 3600})
			}))
			defer oauth.Close()
			c := f.call("POST", "/admin/connectors", resource.Object{
				"name": "系统独立认证", "url": remote.URL, "authorization_mode": "independent", "authorization_method": method,
				"oauth_config": resource.Object{"client_id": "client", "token_url": oauth.URL, "authorization_url": oauth.URL},
				"grants":       []resource.Object{{"user_id": f.users["other"]}},
			}, "owner", "", 200)
			keys := apikey.NewService(apikey.NewPostgres(f.pool))
			key, err := keys.Create(t.Context(), f.users["other"], apikey.CreateInput{Name: "工具调用", Scopes: []string{apikey.ScopeMCPInvoke}})
			if err != nil {
				t.Fatal(err)
			}
			f.service.RegisterGateway(f.router.(chi.Router), keys, nil)
			path := "/agent/connectors/" + c.String("id")
			var cred resource.Object
			authorize := func() {
				t.Helper()
				target, revision := path, ""
				if cred != nil {
					target += "/credentials/" + cred.String("id")
					revision = etag(cred)
				}
				if method == "http_header" {
					verb := "PATCH"
					if cred == nil {
						target += "/credentials"
						verb = "POST"
					}
					status := 200
					if verb == "POST" {
						status = 201
					}
					cred = f.call(verb, target, resource.Object{"name": "工作凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}, "other", revision, status)
					return
				}
				auth := f.call("POST", target+"/oauth/authorizations", resource.Object{"name": "工作凭证"}, "other", revision, 200)
				u, _ := url.Parse(auth.String("authorization_url"))
				f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+u.Query().Get("state")+"&code=code", nil, "", "", 200)
				status := f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "other", "", 200)
				if status.String("status") != "succeeded" {
					t.Fatal("用户授权未成功")
				}
				cred = f.call("GET", path+"/credentials/"+status.String("credential_id"), nil, "other", "", 200)
			}
			check := func(want int) []any {
				t.Helper()
				items := f.call("GET", path+"/credentials/"+cred.String("id")+"/tools", nil, "other", "", 200)["items"].([]any)
				if len(items) != want {
					t.Fatalf("用户凭证工具接口返回 %d 项，预期 %d 项", len(items), want)
				}
				catalog, err := f.service.Catalog(t.Context(), f.pool, c, f.users["other"])
				if err != nil {
					t.Fatal(err)
				}
				credentials := catalog["credentials"].([]resource.Object)
				if len(credentials) != 1 || len(credentials[0]["tools"].([]resource.Object)) != want {
					t.Fatal("用户目录中的工具与凭证工具接口不一致")
				}
				body, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
				r := httptest.NewRequest("POST", "/mcp/connectors/"+c.String("id")+"/credentials/"+cred.String("id"), bytes.NewReader(body))
				r.Header.Set("Authorization", "Bearer "+key.APIKey)
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				f.router.ServeHTTP(w, r)
				var reply struct {
					Result struct {
						Tools []remoteTool `json:"tools"`
					} `json:"result"`
				}
				if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &reply) != nil || len(reply.Result.Tools) != want || (want > 0 && reply.Result.Tools[0].Name != "same_tool") {
					t.Fatalf("MCP tools/list 未返回用户可见工具: %d %s", w.Code, w.Body.String())
				}
				return items
			}
			authorize()
			items := check(1)
			tool := items[0].(map[string]any)
			f.call("PATCH", "/admin/connectors/"+c.String("id")+"/tools/"+tool["id"].(string), resource.Object{"enabled": false, "credits_per_call": "0"}, "owner", "", 200)
			authorize()
			check(0)
		})
	}
}
