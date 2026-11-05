package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func centralCredential(out resource.Object) resource.Object {
	items, _ := out["credentials"].([]any)
	if len(items) == 0 {
		return nil
	}
	return resource.Object(items[0].(map[string]any))
}

func TestCombinedConnectorCredentials(t *testing.T) {
	f := setup(t)
	remote := mcpRemote(t, nil)
	create := func(name, mode, method string, credential any) resource.Object {
		in := resource.Object{"name": name, "url": remote.URL, "authorization_mode": mode, "authorization_method": method}
		if method == "oauth" {
			in["oauth_config"] = resource.Object{"mode": "dynamic"}
		}
		if credential != nil {
			in["credential"] = credential
		}
		return f.call("POST", "/admin/connectors", in, "owner", "", 200)
	}
	save := func(c resource.Object, in resource.Object, want int) resource.Object {
		return f.call("PUT", "/admin/connectors/"+c.String("id"), in, "owner", etag(c), want)
	}
	t.Run("create update preserve revoke and recreate", func(t *testing.T) {
		c := create("combined-header", "centralized", "http_header", resource.Object{"name": "team", "http_headers": resource.Object{"Authorization": "header-secret"}})
		cred := centralCredential(c)
		if cred == nil || cred.String("authorization_status") != "authorized" || cred.String("connection_status") != "connected" {
			t.Fatalf("credential not saved and tested: %v", c)
		}
		oldID := cred.String("id")
		c = save(c, resource.Object{"name": "renamed-connector"}, 200)
		if centralCredential(c).Int("revision") != cred.Int("revision") {
			t.Fatal("omitted credential changed secrets or credential revision")
		}
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "name": "renamed-credential"}}, 200)
		cred = centralCredential(c)
		if cred.String("name") != "renamed-credential" || cred.String("authorization_status") != "authorized" {
			t.Fatal("rename lost credential")
		}
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{"X-Key": "replacement"}}}, 200)
		cred = centralCredential(c)
		if fmt.Sprint(cred["header_names"]) != "[X-Key]" {
			t.Fatal("headers were not replaced")
		}
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "revoke": true}}, 200)
		if centralCredential(c) != nil {
			t.Fatal("revoke did not remove active credential")
		}
		c = save(c, resource.Object{"credential": resource.Object{"name": "replacement", "http_headers": resource.Object{"Authorization": "header-secret"}}}, 200)
		if centralCredential(c).String("id") == oldID {
			t.Fatal("recreated credential reused revoked identity")
		}
		path := "/admin/connectors/" + c.String("id")
		f.call("POST", path+"/credentials", resource.Object{"name": "legacy"}, "owner", "", 405)
		f.call("PATCH", path+"/credentials/"+centralCredential(c).String("id"), resource.Object{"name": "legacy"}, "owner", "", 405)
		f.call("DELETE", path+"/credentials/"+centralCredential(c).String("id"), nil, "owner", "", 405)
	})
	t.Run("blank header values preserve secrets and removals persist", func(t *testing.T) {
		c := create("preserve-header-values", "centralized", "http_header", resource.Object{"name": "team", "http_headers": resource.Object{"Authorization": "header-secret", "X-Key": "second-secret"}})
		cred := centralCredential(c)
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{"authorization": "", "X-Key": "updated-secret", "X-New": "new-secret"}}}, 200)
		readHeaders := func() map[string]string {
			t.Helper()
			var raw []byte
			if err := f.pool.QueryRow(t.Context(), `SELECT http_headers FROM connector_credentials WHERE id=$1`, cred.String("id")).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var headers map[string]string
			if err := json.Unmarshal(raw, &headers); err != nil {
				t.Fatal(err)
			}
			return headers
		}
		headers := readHeaders()
		if len(headers) != 3 || headers["authorization"] != "header-secret" || headers["X-Key"] != "updated-secret" || headers["X-New"] != "new-secret" {
			t.Fatal("blank value lost secret or explicit value not updated")
		}
		cred = centralCredential(c)
		save(c, resource.Object{"name": "must-rollback", "credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{"X-Unknown": ""}}}, 400)
		current := f.call("GET", "/admin/connectors/"+c.String("id"), nil, "owner", "", 200)
		if current.String("name") != c.String("name") || current.Int("revision") != c.Int("revision") || centralCredential(current).Int("revision") != cred.Int("revision") {
			t.Fatal("invalid blank header did not roll back")
		}
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{"authorization": ""}}}, 200)
		if headers = readHeaders(); len(headers) != 1 || headers["authorization"] != "header-secret" {
			t.Fatal("removed header was retained or retained header lost secret")
		}
		encoded, _ := json.Marshal(c)
		if bytes.Contains(encoded, []byte("header-secret")) || bytes.Contains(encoded, []byte("updated-secret")) {
			t.Fatal("credential response exposed secrets")
		}
		f.call("POST", "/admin/connectors", resource.Object{"name": "new-blank", "url": remote.URL, "authorization_mode": "centralized", "authorization_method": "http_header", "credential": resource.Object{"name": "team", "http_headers": resource.Object{"Authorization": ""}}}, "owner", "", 400)
	})
	t.Run("empty header set revokes only on a successful versioned save", func(t *testing.T) {
		c := create("clear-headers", "centralized", "http_header", resource.Object{"name": "team", "http_headers": resource.Object{"Authorization": "header-secret", "X-Key": "second-secret"}})
		cred := centralCredential(c)
		path := "/admin/connectors/" + c.String("id")
		metadata := f.call("GET", path+"/credentials/"+cred.String("id"), nil, "owner", "", 200)
		if fmt.Sprint(metadata["header_names"]) != "[Authorization X-Key]" || metadata["http_headers"] != nil {
			t.Fatal("credential metadata must include every key without secret values")
		}
		empty := func(revision any) resource.Object {
			return resource.Object{"id": cred["id"], "revision": revision, "http_headers": resource.Object{}}
		}
		save(c, resource.Object{"credential": empty(cred.Int("revision") + 1)}, 412)
		f.call("PUT", path, resource.Object{"credential": empty(cred["revision"])}, "owner", `"0"`, 412)
		save(c, resource.Object{"name": "must-rollback", "tag_ids": []string{resource.ID()}, "credential": empty(cred["revision"])}, 400)
		current := f.call("GET", path, nil, "owner", "", 200)
		if current.Int("revision") != c.Int("revision") || centralCredential(current).String("id") != cred.String("id") {
			t.Fatal("failed clear changed the saved credential")
		}
		c = save(c, resource.Object{"credential": empty(cred["revision"])}, 200)
		if centralCredential(c) != nil || c.Int("revision") != current.Int("revision")+1 {
			t.Fatal("empty header set did not clear the credential")
		}
		f.call("GET", path+"/credentials/"+cred.String("id"), nil, "owner", "", 404)
		f.call("POST", path+"/test", nil, "owner", "", 403)
		var tools int
		if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM mcp_tools WHERE credential_id=$1 AND deleted_at IS NULL`, cred.String("id")).Scan(&tools); err != nil {
			t.Fatal(err)
		}
		if tools != 0 {
			t.Fatal("cleared credential kept tools available")
		}
		c = save(c, resource.Object{"credential": resource.Object{"http_headers": resource.Object{}}}, 200)
		if centralCredential(c) != nil {
			t.Fatal("repeated empty save created a credential")
		}
		c = save(c, resource.Object{"credential": resource.Object{"name": "restored", "http_headers": resource.Object{"X-Key": "new-secret"}}}, 200)
		if centralCredential(c) == nil || centralCredential(c).String("id") == cred.String("id") {
			t.Fatal("new header set did not recreate a distinct credential")
		}
		emptyConnector := create("new-empty-header-set", "centralized", "http_header", resource.Object{"name": "team", "http_headers": resource.Object{}})
		if centralCredential(emptyConnector) != nil {
			t.Fatal("empty set created an authorized credential")
		}
	})
	t.Run("atomic rollback after credential persistence", func(t *testing.T) {
		c := create("rollback", "centralized", "http_header", resource.Object{"name": "original", "http_headers": resource.Object{"Authorization": "header-secret"}})
		cred := centralCredential(c)
		// Invalid tags fail after the credential persistence hook has run.
		save(c, resource.Object{"name": "must-rollback", "tag_ids": []string{resource.ID()}, "credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "name": "must-rollback", "http_headers": resource.Object{"X-Key": "must-rollback"}}}, 400)
		current := f.call("GET", "/admin/connectors/"+c.String("id"), nil, "owner", "", 200)
		if current.String("name") != "rollback" || current.Int("revision") != c.Int("revision") || centralCredential(current).String("name") != "original" || centralCredential(current).Int("revision") != cred.Int("revision") {
			t.Fatal("partial update survived rollback")
		}
		var count int
		if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM connectors WHERE name='failed-create'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatal("unexpected test state")
		}
		f.call("POST", "/admin/connectors", resource.Object{"name": "failed-create", "url": remote.URL, "authorization_mode": "centralized", "authorization_method": "http_header", "tag_ids": []string{resource.ID()}, "credential": resource.Object{"name": "failed", "http_headers": resource.Object{"Authorization": "header-secret"}}}, "owner", "", 400)
		if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM connectors WHERE name='failed-create'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatal("failed create left a connector or credential")
		}
	})
	t.Run("remote failure keeps saved configuration and reports a safe error", func(t *testing.T) {
		unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
		defer unavailable.Close()
		c := f.call("POST", "/admin/connectors", resource.Object{"name": "remote-failure", "url": unavailable.URL, "authorization_mode": "centralized", "authorization_method": "http_header", "credential": resource.Object{"name": "retained", "http_headers": resource.Object{"Authorization": "header-secret"}}}, "owner", "", 200)
		cred := centralCredential(c)
		if cred == nil || cred.String("authorization_status") != "authorized" || cred.String("connection_status") != "error" || cred.String("last_error") == "" {
			t.Fatal("remote failure rolled back credentials or lost its error state")
		}
	})
	t.Run("mode validation and version conflicts", func(t *testing.T) {
		for _, mode := range []string{"none", "independent"} {
			f.call("POST", "/admin/connectors", resource.Object{"name": "wrong-" + mode, "url": remote.URL, "authorization_mode": mode, "authorization_method": "http_header", "credential": resource.Object{"name": "wrong", "http_headers": resource.Object{"Authorization": "header-secret"}}}, "owner", "", 400)
		}
		c := create("versions", "centralized", "http_header", resource.Object{"name": "version", "http_headers": resource.Object{"Authorization": "header-secret"}})
		cred := centralCredential(c)
		save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "name": "missing-revision"}}, 428)
		save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred.Int("revision") + 1, "name": "stale"}}, 412)
		save(c, resource.Object{"name": "changed", "credential": resource.Object{"name": "overwrite-without-version", "http_headers": resource.Object{"Authorization": "header-secret"}}}, 412)
		current := f.call("GET", "/admin/connectors/"+c.String("id"), nil, "owner", "", 200)
		if current.Int("revision") != c.Int("revision") || current.String("name") != "versions" {
			t.Fatal("conflict changed the connector")
		}
		// Both connector and credential versions must be checked before one concurrent writer wins.
		data, _ := json.Marshal(resource.Object{"name": "concurrent", "credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "name": "concurrent"}})
		statuses := make(chan int, 2)
		for range 2 {
			go func() {
				req := httptest.NewRequest("PUT", "/admin/connectors/"+c.String("id"), bytes.NewReader(data))
				req.Header.Set("Authorization", "Bearer owner")
				req.Header.Set("If-Match", etag(c))
				w := httptest.NewRecorder()
				f.router.ServeHTTP(w, req)
				statuses <- w.Code
			}()
		}
		a, b := <-statuses, <-statuses
		if !((a == 200 && b == 412) || (a == 412 && b == 200)) {
			t.Fatalf("concurrent status: %d, %d", a, b)
		}
	})
	t.Run("OAuth placeholder and token ownership", func(t *testing.T) {
		c := create("oauth-placeholder", "centralized", "oauth", resource.Object{"name": "OAuth"})
		cred := centralCredential(c)
		if cred == nil || cred.String("authorization_status") != "authorization_required" {
			t.Fatal("OAuth placeholder missing")
		}
		save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{"Authorization": "header-secret"}}}, 400)
		save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{}}}, 400)
		// Configuration writes cannot forge OAuth tokens.
		save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "oauth_access_token": "oauth-secret"}}, 400)
	})
	t.Run("disabled connector can configure credentials", func(t *testing.T) {
		c := f.call("POST", "/admin/connectors", resource.Object{"name": "disabled-config", "url": remote.URL, "enabled": false, "authorization_mode": "centralized", "authorization_method": "http_header", "credential": resource.Object{"name": "offline", "http_headers": resource.Object{"Authorization": "header-secret"}}}, "owner", "", 200)
		if c.Bool("enabled") || centralCredential(c).String("authorization_status") != "authorized" {
			t.Fatal("disabled connector could not save credentials")
		}
	})
	t.Run("package credential is local and transactionally versioned", func(t *testing.T) {
		c := create("package", "centralized", "http_header", nil)
		importID := resource.ID()
		f.sql(`INSERT INTO resource_imports(id,publisher,release_id,version,manifest_sha256,actor_user_id,status) VALUES($1,'test.publisher',$2,1,$3,$4,'succeeded')`, importID, resource.ID(), "sha256:"+strings.Repeat("a", 64), f.users["owner"])
		f.sql(`INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id) VALUES('test.publisher','connector','connector',$1,$2,$2,$3)`, c.String("id"), "sha256:"+strings.Repeat("a", 64), importID)
		f.sql(`UPDATE connectors SET origin='package' WHERE id=$1`, c.String("id"))
		before := c.Int("revision")
		c = save(c, resource.Object{"credential": resource.Object{"name": "local", "http_headers": resource.Object{"Authorization": "header-secret"}}}, 200)
		if c.Int("revision") != before+1 || centralCredential(c) == nil {
			t.Fatal("package credential-only save did not persist or bump version")
		}
		var overrides string
		if err := f.pool.QueryRow(t.Context(), `SELECT admin_overrides::text FROM connectors WHERE id=$1`, c.String("id")).Scan(&overrides); err != nil {
			t.Fatal(err)
		}
		if overrides != "{}" {
			t.Fatalf("credential leaked into package overrides: %s", overrides)
		}
		cred := centralCredential(c)
		save(c, resource.Object{"name": "must-rollback-package", "credential": resource.Object{"id": cred["id"], "revision": cred.Int("revision") + 1, "name": "stale"}}, 412)
		current := f.call("GET", "/admin/connectors/"+c.String("id"), nil, "owner", "", 200)
		if current.String("name") != "package" || current.Int("revision") != c.Int("revision") {
			t.Fatal("package update did not roll back")
		}
		c = save(c, resource.Object{"name": "package-local", "credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "name": "local-renamed"}}, 200)
		if c.String("name") != "package-local" || centralCredential(c).String("name") != "local-renamed" {
			t.Fatal("package metadata plus credential update failed")
		}
		cred = centralCredential(c)
		before = c.Int("revision")
		c = save(c, resource.Object{"credential": resource.Object{"id": cred["id"], "revision": cred["revision"], "http_headers": resource.Object{}}}, 200)
		if centralCredential(c) != nil || c.Int("revision") != before+1 {
			t.Fatal("package credential clear did not revoke or bump version")
		}
		if err := f.pool.QueryRow(t.Context(), `SELECT admin_overrides::text FROM connectors WHERE id=$1`, c.String("id")).Scan(&overrides); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(overrides, "credential") || strings.Contains(overrides, "http_headers") {
			t.Fatal("package credential clear leaked into overrides")
		}
	})
}
