package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type iconStorage map[string][]byte

func (s iconStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s[key] = bytes.Clone(data)
	return nil
}
func (s iconStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s[key])), nil
}
func (s iconStorage) Delete(_ context.Context, key string) error { delete(s, key); return nil }
func (s iconStorage) Ping(context.Context) error                 { return nil }

func TestPersonalConnectors(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行个人 Connector 数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "test_personal_mcp_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	migrations, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range migrations {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	users := map[string]string{"owner": resource.ID(), "other": resource.ID()}
	for token, id := range users {
		if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,$2,$2||'@example.com')`, id, token); err != nil {
			t.Fatal(err)
		}
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(token)))
		if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$2,now()+interval '1 hour',now()+interval '2 hours')`, id, hash); err != nil {
			t.Fatal(err)
		}
	}
	s := NewService(resource.NewStore(pool), "http://localhost").WithStorage(iconStorage{})
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "http://localhost", "http://localhost").RequireAgent)
	s.RegisterAgent(router)
	call := func(method, path string, body any, token, match string, status int) resource.Object {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("If-Match", match)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s = %d %s，预期 %d", method, path, w.Code, w.Body.String(), status)
		}
		var out resource.Object
		if status != http.StatusNoContent {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	etag := func(o resource.Object) string { return fmt.Sprintf(`"%v"`, o["revision"]) }
	seedProvider := func(mode string, enabled bool) resource.Object {
		t.Helper()
		p, err := s.Providers.Save(ctx, users["owner"], "", "", resource.Object{"name": "系统-" + mode, "url": "https://example.com/mcp", "authorization_mode": mode, "authorization_method": "http_header", "enabled": enabled})
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	none := seedProvider("none", true)
	independent := seedProvider("independent", true)
	centralized := seedProvider("centralized", true)
	disabled := seedProvider("none", false)
	for _, mode := range []string{"centralized", "invalid"} {
		call("POST", "/connector-providers", resource.Object{"name": "无效模式", "url": "https://example.com/mcp", "authorization_mode": mode, "authorization_method": "http_header"}, "owner", "", 400)
	}
	p := call("POST", "/connector-providers", resource.Object{
		"name": "个人 Provider", "identifier": "client-supplied", "url": "https://example.com/private", "authorization_mode": "independent", "authorization_method": "oauth",
		"oauth_config":        resource.Object{"client_id": "private-client", "authorization_url": "https://example.com/authorize", "token_url": "https://example.com/token", "client_secret": "嵌套秘密"},
		"oauth_client_secret": "个人秘密", "ownership_type": "system", "owner_user_id": users["other"], "enabled": false,
	}, "owner", "", 201)
	if p["identifier"] != nil || p.String("ownership_type") != "user" || p.String("owner_user_id") != users["owner"] || !p.Bool("enabled") {
		t.Fatalf("个人 Provider 归属或 identifier 无效：%v", p)
	}
	encoded, _ := json.Marshal(p)
	if strings.Contains(string(encoded), "秘密") || strings.Contains(string(encoded), "oauth_client_secret") {
		t.Fatal("响应包含 OAuth 秘密")
	}
	providerPath := "/connector-providers/" + p.String("id")
	if _, err := s.Connectors.Save(ctx, users["other"], "", "", resource.Object{"name": "组织引用个人 Provider", "provider_id": p["id"]}); err == nil {
		t.Fatal("组织 Connector 不得使用个人 Provider")
	} else if failure, ok := err.(*resource.Error); !ok || failure.Status != http.StatusBadRequest {
		t.Fatalf("组织使用个人 Provider 应返回 400：%v", err)
	}
	for _, denied := range []resource.Object{centralized, disabled} {
		call("GET", "/connector-providers/"+denied.String("id"), nil, "owner", "", 404)
	}
	call("GET", providerPath, nil, "other", "", 404)
	call("PUT", providerPath, resource.Object{"name": "越权修改"}, "other", etag(p), 404)
	call("DELETE", providerPath, nil, "other", etag(p), 404)
	call("PUT", providerPath, resource.Object{"name": "缺少版本"}, "owner", "", 428)
	call("PUT", providerPath, resource.Object{"name": "旧版本"}, "owner", `"0"`, 412)
	p = call("PUT", providerPath, resource.Object{"name": "个人 Provider 新名称", "identifier": "spoofed", "enabled": false}, "owner", etag(p), 200)
	if p["identifier"] != nil || p.String("url") != "https://example.com/private" || !p.Bool("enabled") {
		t.Fatal("编辑未保留受保护配置")
	}
	list := call("GET", "/connector-providers", nil, "owner", "", 200)
	if len(list["items"].([]any)) != 3 {
		t.Fatalf("Provider 发现范围无效：%v", list)
	}
	for _, denied := range []resource.Object{centralized, disabled} {
		call("POST", "/connectors", resource.Object{"name": "禁止连接", "provider_id": denied["id"]}, "owner", "", 400)
	}
	call("POST", "/connectors", resource.Object{"name": "越权 Provider", "provider_id": p["id"]}, "other", "", 400)
	c := call("POST", "/connectors", resource.Object{"name": "个人连接", "provider_id": independent["id"], "url": "https://ignored.example.com", "authorization_mode": "centralized", "oauth_client_secret": "伪造秘密", "config_revision": 10, "connection_status": "connected", "enabled": false}, "owner", "", 201)
	if c.String("ownership_type") != "user" || c.String("owner_user_id") != users["owner"] || c.String("url") != independent.String("url") || c.String("authorization_mode") != "independent" || c.Int("config_revision") != 1 || c.String("connection_status") != "unknown" || !c.Bool("enabled") {
		t.Fatalf("个人连接没有固定 Provider 配置：%v", c)
	}
	connectorPath := "/connectors/" + c.String("id")
	call("GET", connectorPath, nil, "other", "", 404)
	call("PUT", connectorPath, resource.Object{"name": "越权"}, "other", etag(c), 404)
	call("DELETE", connectorPath, nil, "other", etag(c), 404)
	call("PUT", connectorPath, resource.Object{"name": "更换 Provider", "provider_id": none["id"]}, "owner", etag(c), 400)
	c = call("PUT", connectorPath, resource.Object{"name": "个人连接新名称"}, "owner", etag(c), 200)
	if c.String("provider_id") != independent.String("id") {
		t.Fatal("未提交 provider_id 时丢失 Provider")
	}
	call("PUT", connectorPath+"/credential", resource.Object{"http_headers": resource.Object{"Authorization": "Bearer private-token"}}, "owner", "", 204)
	call("PUT", connectorPath+"/credential", resource.Object{"http_headers": resource.Object{"Authorization": "Bearer other-token"}}, "other", "", 404)
	c = call("GET", connectorPath, nil, "owner", "", 200)
	if !c.Bool("credential_configured") {
		t.Fatal("个人 Connector 未反映本人凭证状态")
	}
	var credentialOwner string
	if err := pool.QueryRow(ctx, "SELECT user_id::text FROM connector_credentials WHERE connector_id=$1", c.String("id")).Scan(&credentialOwner); err != nil || credentialOwner != users["owner"] {
		t.Fatalf("凭证未隔离至 Connector 所有者：%s %v", credentialOwner, err)
	}
	call("DELETE", connectorPath, nil, "owner", etag(c), 204)
	var revoked bool
	if err := pool.QueryRow(ctx, "SELECT revoked_at IS NOT NULL AND status='revoked' FROM connector_credentials WHERE connector_id=$1", c.String("id")).Scan(&revoked); err != nil || !revoked {
		t.Fatalf("删除连接未撤销凭证：%v", err)
	}
	private := call("POST", "/connectors", resource.Object{"name": "自有 Provider 连接", "provider_id": p["id"]}, "owner", "", 201)
	call("PUT", providerPath, resource.Object{"name": "改变模板", "url": "https://example.com/changed"}, "owner", etag(p), 400)
	p = call("PUT", providerPath, resource.Object{"name": "轮换秘密", "oauth_client_secret": "新秘密"}, "owner", etag(p), 200)
	var secret string
	if err := pool.QueryRow(ctx, "SELECT oauth_client_secret FROM connectors WHERE id=$1", private.String("id")).Scan(&secret); err != nil || secret != "新秘密" {
		t.Fatalf("OAuth Secret 轮换未更新已有连接：%v", err)
	}
	call("DELETE", providerPath, nil, "owner", etag(p), 409)
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	file, err := writer.CreateFormFile("icon", "icon.png")
	if err != nil {
		t.Fatal(err)
	}
	if err = png.Encode(file, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path, token string
		status      int
	}{{providerPath, "other", 404}, {"/connector-providers/" + none.String("id"), "owner", 404}, {providerPath, "owner", 200}} {
		r := httptest.NewRequest("PUT", test.path+"/icon", bytes.NewReader(form.Bytes()))
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.Header.Set("Authorization", "Bearer "+test.token)
		r.Header.Set("If-Match", etag(p))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("上传 Provider 图标 = %d %s，预期 %d", w.Code, w.Body.String(), test.status)
		}
	}
	p = call("GET", providerPath, nil, "owner", "", 200)
	if !strings.HasPrefix(p.String("icon_path"), "/api/v1/connector-providers/") {
		t.Fatalf("个人图标下发路径无效：%v", p)
	}
	for _, test := range []struct {
		crud     *resource.CRUD
		object   resource.Object
		userPath string
	}{{s.Providers, p, "/api/v1/connector-providers/" + p.String("id")}, {s.Connectors, private, "/api/v1/connectors/" + private.String("id")}} {
		admin, err := test.crud.Get(ctx, pool, test.object.String("id"))
		if err != nil || !strings.HasPrefix(admin.String("icon_path"), "/api/admin/v1/connector-providers/"+p.String("id")+"/icon?v=") {
			t.Fatalf("管理端个人资源图标路径无效：%v %v", admin, err)
		}
		user, err := test.crud.GetUser(ctx, pool, test.object.String("id"), users["owner"])
		if err != nil || !strings.HasPrefix(user.String("icon_path"), test.userPath+"/icon?v=") {
			t.Fatalf("用户端个人资源图标路径无效：%v %v", user, err)
		}
	}
	call("GET", providerPath+"/icon", nil, "other", "", 404)
	private = call("GET", "/connectors/"+private.String("id"), nil, "owner", "", 200)
	call("DELETE", "/connectors/"+private.String("id"), nil, "owner", etag(private), 204)
	call("DELETE", providerPath, nil, "owner", etag(p), 204)
}
