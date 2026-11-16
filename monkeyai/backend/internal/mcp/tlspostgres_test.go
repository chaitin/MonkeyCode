package mcp

import (
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestConnectorTLSConfigPersistence(t *testing.T) {
	f := setup(t)
	server := tlsTestRemote(t)
	for _, scope := range []string{"admin", "agent"} {
		t.Run(scope, func(t *testing.T) {
			createStatus := 200
			if scope == "agent" {
				createStatus = 201
			}
			base := "/" + scope + "/connectors"
			c := f.call("POST", base, resource.Object{"name": scope + "-tls-default", "url": server.URL, "authorization_mode": "none"}, "owner", "", createStatus)
			if value, ok := c["skip_tls_verify"].(bool); !ok || value {
				t.Fatalf("连接器应默认启用证书校验: %v", c["skip_tls_verify"])
			}
			path := base + "/" + c.String("id")
			f.call("POST", path+"/test", nil, "owner", "", 502)
			c = f.call("GET", path, nil, "owner", "", 200)
			before := c.Int("config_revision")
			c = f.call("PUT", path, resource.Object{"name": c["name"], "skip_tls_verify": true}, "owner", etag(c), 200)
			if !c.Bool("skip_tls_verify") || c.Int("config_revision") != before+1 || c.String("connection_status") != "unknown" {
				t.Fatal("开启跳过校验未保存或未使旧连接测试失效")
			}
			f.call("POST", path+"/test", nil, "owner", "", 200)
			tools := f.call("GET", path+"/tools", nil, "owner", "", 200)
			if len(tools["items"].([]any)) != 1 {
				t.Fatal("启用跳过校验后未能读取工具")
			}
			c = f.call("GET", path, nil, "owner", "", 200)
			before = c.Int("config_revision")
			c = f.call("PUT", path, resource.Object{"name": scope + "-tls-renamed"}, "owner", etag(c), 200)
			if !c.Bool("skip_tls_verify") || c.Int("config_revision") != before {
				t.Fatal("未提供开关的部分更新未保留 TLS 配置")
			}
			c = f.call("PUT", path, resource.Object{"name": c["name"], "skip_tls_verify": false}, "owner", etag(c), 200)
			if c.Bool("skip_tls_verify") || c.Int("config_revision") != before+1 {
				t.Fatal("关闭跳过校验未生效")
			}
			f.call("POST", path+"/test", nil, "owner", "", 502)
			f.call("POST", base, resource.Object{"name": scope + "-tls-invalid", "url": server.URL, "authorization_mode": "none", "skip_tls_verify": "true"}, "owner", "", 400)
			created := f.call("POST", base, resource.Object{"name": scope + "-tls-enabled", "url": server.URL, "authorization_mode": "none", "skip_tls_verify": true}, "owner", "", createStatus)
			if !created.Bool("skip_tls_verify") {
				t.Fatal("创建连接器时未保存 TLS 配置")
			}
		})
	}
}

func TestPackageConnectorTLSOverride(t *testing.T) {
	f := setup(t)
	server := tlsTestRemote(t)
	c := f.call("POST", "/admin/connectors", resource.Object{"name": "package-tls", "url": server.URL, "authorization_mode": "none"}, "owner", "", 200)
	importID := resource.ID()
	f.sql(`INSERT INTO resource_imports(id,publisher,release_id,version,manifest_sha256,actor_user_id,status) VALUES($1,'test.publisher',$2,1,$3,$4,'succeeded')`, importID, resource.ID(), "sha256:"+strings.Repeat("a", 64), f.users["owner"])
	f.sql(`INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id) VALUES('test.publisher','connector','connector',$1,$2,$2,$3)`, c.String("id"), "sha256:"+strings.Repeat("a", 64), importID)
	f.sql(`UPDATE connectors SET origin='package' WHERE id=$1`, c.String("id"))
	path := "/admin/connectors/" + c.String("id")
	for _, skip := range []bool{true, false} {
		c = f.call("PUT", path, resource.Object{"skip_tls_verify": skip}, "owner", etag(c), 200)
		var stored, overridden bool
		if err := f.pool.QueryRow(t.Context(), `SELECT skip_tls_verify, admin_overrides ? 'skip_tls_verify' FROM connectors WHERE id=$1`, c.String("id")).Scan(&stored, &overridden); err != nil || stored != skip || !overridden || c.Bool("skip_tls_verify") != skip {
			t.Fatalf("资源包连接器的 TLS 配置未保存为本地覆盖: %v", err)
		}
	}
}
