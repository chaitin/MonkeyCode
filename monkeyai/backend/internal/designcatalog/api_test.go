package designcatalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
)

type ownedDevices struct{}

func (ownedDevices) OwnedDevice(_ context.Context, user, machine string) (string, error) {
	if machine != "owned-machine" {
		return "", fault(403, "forbidden", "设备不属于当前用户")
	}
	return machine, nil
}
func TestCatalogPathEncoding(t *testing.T) {
	router := chi.NewRouter()
	router.Get("/r/{id}/*", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]string{pathParam(r, "id"), pathParam(r, "*")})
	})
	for _, tc := range []struct{ uri, id, path string }{{"/r/id%3Acolon/image%40file.png", "id:colon", "image@file.png"}, {"/r/%252F/100%25.png", "%2F", "100%.png"}, {"/r/sample.bundle/media/a%20b.png", "sample.bundle", "media/a b.png"}} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", tc.uri, nil))
		var got []string
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got) != 2 || got[0] != tc.id || got[1] != tc.path {
			t.Fatalf("路径未按单层URL编码解析: %s %s %v", tc.uri, w.Body.String(), err)
		}
	}
}

func TestCatalogContract(t *testing.T) {
	pool, actor := designDatabase(t)
	store := newStorage()
	s := NewService(pool, store).WithAccess(AccessConfig{PublicURL: "https://local.example", InstanceID: "fixture-instance", MediaSecret: "fixture-local-media-secret", RespubSecret: "fixture-hub-secret", RespubURL: "https://hub.example/api/design"}).WithDevices(ownedDevices{})
	tokenHash := sha256.Sum256([]byte("agent-access"))
	if _, err := pool.Exec(t.Context(), "INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'monkeyai-desktop',$2,'design-refresh',now()+interval '1 hour',now()+interval '1 day')", actor, hex.EncodeToString(tokenHash[:])); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterCatalog(router, identity.NewService(pool, nil, "http://localhost").RequireAgent)
	call := func(method, path, auth string, headers map[string]string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		var raw []byte
		if body != nil {
			raw = payload(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		if auth != "" {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: got %d expected %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w
	}
	base := "/api/v1/design-resources"
	noauth := call("GET", base+"/catalog/snapshot", "", nil, nil, 401)
	if !strings.Contains(noauth.Body.String(), `"code":"unauthorized"`) {
		t.Fatal("认证信封未转换")
	}
	call("GET", base+"/catalog/snapshot", "agent-access", nil, nil, 404)
	cfg := call("GET", base+"/config", "agent-access", nil, nil, 200)
	if !bytes.Contains(cfg.Body.Bytes(), []byte(`"available":false`)) || bytes.Contains(cfg.Body.Bytes(), []byte("fixture-hub-secret")) {
		t.Fatal("未导入配置错误")
	}
	call("POST", base+"/token", "agent-access", nil, map[string]any{"machine_id": "foreign", "target": "respub"}, 403)
	tokenResponse := call("POST", base+"/token", "agent-access", nil, map[string]any{"machine_id": "owned-machine", "target": "monkeyai-media"}, 200)
	var token struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(tokenResponse.Body.Bytes(), &token); err != nil {
		t.Fatal(err)
	}
	if tokenResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("token 可缓存")
	}
	claims, err := s.mediaClaims(token.Token, time.Now())
	if err != nil || claims.ClientID != "owned-machine" || claims.Subject != actor {
		t.Fatal("媒体 claims 错误", err)
	}
	hubResponse := call("POST", base+"/token", "agent-access", nil, map[string]any{"machine_id": "owned-machine", "target": "respub"}, 200)
	var hubToken struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(hubResponse.Body.Bytes(), &hubToken); err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(hubToken.Token, ".")
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var hubClaims map[string]any
	if err = json.Unmarshal(body, &hubClaims); err != nil {
		t.Fatal(err)
	}
	if hubClaims["aud"] != "respub-design" || hubClaims["iss"] != "monkeyai" || hubClaims["client_id"] != "owned-machine" || hubClaims["sub"] != nil {
		t.Fatal("hub claims错误", hubClaims)
	}
	p := fixture(t)
	if err = s.Prepare(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	plan, err := s.Plan(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Apply(t.Context(), tx, p, actor, plan.PlanDigest); err != nil {
		tx.Rollback(t.Context())
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	snapshot := call("GET", base+"/catalog/snapshot", "agent-access", nil, nil, 200)
	if !bytes.Contains(snapshot.Body.Bytes(), []byte(p.ReleaseID)) {
		t.Fatal("快照身份错误")
	}
	list := call("GET", base+"/catalog/templates?page_size=1", "agent-access", nil, nil, 200)
	var page struct {
		Data struct {
			Items      []map[string]any `json:"items"`
			Total      int              `json:"total"`
			TotalPages int              `json:"total_pages"`
		} `json:"data"`
	}
	if err = json.Unmarshal(list.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Data.Total != 2 || page.Data.TotalPages != 2 || len(page.Data.Items) != 1 {
		t.Fatal("分页错误")
	}
	for _, field := range []string{"localizedPrompt", "skillPath", "files", "source_skill_path"} {
		if _, ok := page.Data.Items[0][field]; ok {
			t.Fatal("列表泄漏详情", field)
		}
	}
	call("GET", base+"/catalog/templates?page=9223372036854775807", "agent-access", nil, nil, 200)
	call("GET", base+"/catalog/styles?recommended=", "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/templates?variant=unexpected", "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/templates?page=0", "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/styles?recommended=1", "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/templates?snapshot=bad", "agent-access", nil, nil, 404)
	call("GET", base+"/catalog/templates?publisher_id=other", "agent-access", nil, nil, 403)
	call("GET", base+"/catalog/templates?snapshot=release:unknown", "agent-access", nil, nil, 404)
	call("GET", base+"/catalog/templates?snapshot=release:"+p.ReleaseID+"&snapshot=release:"+p.ReleaseID, "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/templates?x=%ZZ", "agent-access", nil, nil, 400)
	call("GET", base+"/catalog/templates/sample.bundle?content_digest=wrong", "agent-access", nil, nil, 409)
	detail := call("GET", base+"/catalog/templates/sample.bundle", "agent-access", nil, nil, 200)
	var entry struct {
		Data map[string]any `json:"data"`
	}
	if err = json.Unmarshal(detail.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Data["source_skill_path"] != "wrap/SKILL.md" {
		t.Fatal("解析后的技能路径错误")
	}
	downloadURL := entry.Data["download_url"].(string)
	parsed, err := url.Parse(downloadURL)
	if err != nil || parsed.Query().Get("snapshot") != "release:"+p.ReleaseID || parsed.Query().Get("publisher_id") != p.PublisherID {
		t.Fatal("下载URL未绑定快照", downloadURL)
	}
	for _, kind := range []string{"design-systems", "styles", "directions"} {
		call("GET", base+"/catalog/"+kind, "agent-access", nil, nil, 200)
	}
	for _, item := range [][3]string{{"design-systems", "sample.system", "content"}, {"styles", "sample.style", "files"}, {"directions", "sample.direction", "prompt"}} {
		reply := call("GET", base+"/catalog/"+item[0]+"/"+item[1], "agent-access", nil, nil, 200)
		var data struct {
			Data map[string]any `json:"data"`
		}
		if err = json.Unmarshal(reply.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		if _, ok := data.Data[item[2]]; !ok {
			t.Fatal("详情字段缺失", item[0], item[2])
		}
	}
	prompt := call("GET", base+"/catalog/templates/sample.prompt", "agent-access", nil, nil, 200)
	var promptData struct {
		Data map[string]any `json:"data"`
	}
	if err = json.Unmarshal(prompt.Body.Bytes(), &promptData); err != nil {
		t.Fatal(err)
	}
	if promptData.Data["download"] != nil || promptData.Data["source_skill_path"] != nil {
		t.Fatal("不可下载/无技能模板详情错误")
	}
	call("GET", base+"/catalog/taxonomy", "agent-access", nil, nil, 200)
	zipPath := parsed.RequestURI()
	download := call("GET", zipPath, "agent-access", nil, nil, 200)
	etag := download.Header().Get("ETag")
	if etag != `"`+strings.TrimPrefix(Hash(download.Body.Bytes()), "sha256:")+`"` {
		t.Fatal("强ETag不是ZIP字节SHA")
	}
	head := call("HEAD", zipPath, "agent-access", nil, nil, 200)
	if head.Body.Len() != 0 || head.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD行为错误")
	}
	call("GET", zipPath, "agent-access", map[string]string{"If-None-Match": etag}, nil, 304)
	call("GET", zipPath, "", map[string]string{"If-None-Match": etag}, nil, 401)
	part := call("GET", zipPath, "agent-access", map[string]string{"Range": "bytes=0-31"}, nil, 206)
	if !bytes.Equal(part.Body.Bytes(), download.Body.Bytes()[:32]) {
		t.Fatal("ZIP Range错误")
	}
	call("GET", zipPath, "agent-access", map[string]string{"Range": "bytes=99999999-"}, nil, 416)
	call("GET", zipPath, "agent-access", map[string]string{"Range": "bytes=1-x"}, nil, 400)
	full := call("GET", zipPath, "agent-access", map[string]string{"Range": "bytes=0-2", "If-Range": `"wrong"`}, nil, 200)
	if !bytes.Equal(full.Body.Bytes(), download.Body.Bytes()) {
		t.Fatal("If-Range不匹配未返回完整对象")
	}
	call("HEAD", zipPath, "", nil, nil, 401)
	call("GET", base+"/design-systems/sample.system/download", "agent-access", nil, nil, 200)
	media := base + "/catalog/style-assets/sample.style/media/preview/url?token=" + token.Token
	image := call("GET", media, "", nil, nil, 200)
	if image.Header().Get("Content-Type") != "image/png" {
		t.Fatal("媒体MIME错误")
	}
	call("GET", media, "agent-access", nil, nil, 401)
	call("GET", media, "", map[string]string{"If-None-Match": image.Header().Get("ETag")}, nil, 304)
	noToken := strings.Split(media, "?")[0]
	call("GET", noToken, "", map[string]string{"If-None-Match": image.Header().Get("ETag")}, nil, 401)
	multi := call("GET", media, "", map[string]string{"Range": "bytes=0-3,5-8"}, nil, 206)
	boundary := strings.Split(multi.Header().Get("Content-Type"), "boundary=")[1]
	mr := multipart.NewReader(bytes.NewReader(multi.Body.Bytes()), boundary)
	for _, expected := range [][]byte{image.Body.Bytes()[0:4], image.Body.Bytes()[5:9]} {
		part, err := mr.NextPart()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(part)
		if err != nil || !bytes.Equal(raw, expected) {
			t.Fatal("多区间错误")
		}
	}
	errorHead := call("HEAD", media, "agent-access", nil, nil, 401)
	if errorHead.Body.Len() != 0 || errorHead.Header().Get("ETag") != "" || errorHead.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("错误HEAD可缓存或有正文")
	}
	s.access.RespubURL = ""
	cfg = call("GET", base+"/config", "agent-access", nil, nil, 200)
	if !bytes.Contains(cfg.Body.Bytes(), []byte(`"respub":null`)) {
		t.Fatal("离线配置错误")
	}
	call("POST", base+"/token", "agent-access", nil, map[string]any{"machine_id": "owned-machine", "target": "respub"}, 503)
	call("POST", base+"/token", "agent-access", nil, map[string]any{"machine_id": "owned-machine", "target": "monkeyai-media"}, 200)
}
func TestDesignTokenValidation(t *testing.T) {
	s := NewService(nil, nil).WithAccess(AccessConfig{InstanceID: "instance", MediaSecret: "local-secret"})
	now := time.Now()
	valid := Claims{Issuer: "monkeyai", Audience: "monkeyai-design-media", InstanceID: "instance", ClientID: "machine", Subject: "user", IssuedAt: now.Unix(), ExpiresAt: now.Add(10 * time.Minute).Unix()}
	if _, err := s.mediaClaims(signClaims(valid, "local-secret"), now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Claims){func(c *Claims) { c.Audience = "respub-design" }, func(c *Claims) { c.InstanceID = "other" }, func(c *Claims) { c.Subject = "" }, func(c *Claims) { c.ClientID = "" }, func(c *Claims) { c.ExpiresAt = now.Add(-time.Minute).Unix() }, func(c *Claims) { c.IssuedAt = now.Add(time.Minute).Unix() }, func(c *Claims) { c.ExpiresAt = now.Add(time.Hour).Unix() }} {
		bad := valid
		mutate(&bad)
		if _, err := s.mediaClaims(signClaims(bad, "local-secret"), now); err == nil {
			t.Fatal("非法媒体claims被接受", bad)
		}
	}
	if _, err := s.mediaClaims(signClaims(valid, "hub-secret"), now); err == nil {
		t.Fatal("hub密钥被接受")
	}
}
