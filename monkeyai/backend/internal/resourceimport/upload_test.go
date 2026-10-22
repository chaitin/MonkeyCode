package resourceimport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestValidateUpload(t *testing.T) {
	for _, files := range [][]UploadFile{
		{{"release.zip", 5}},
		{{"release.zip.001", 3}, {"release.zip.002", 2}},
		{{"release.ZIP.001", 5}},
	} {
		if total, err := validateUpload(files); err != nil || total != 5 {
			t.Fatalf("有效分卷被拒绝: %v %d %v", files, total, err)
		}
	}
	for _, files := range [][]UploadFile{
		nil, {{"../release.zip", 1}}, {{"release.zip", 0}}, {{"release.zip", MaxPackage + 1}},
		{{"release.zip.002", 1}}, {{"release.zip.001", 1}, {"release.zip.003", 1}},
		{{"release.zip.001", 1}, {"other.zip.002", 1}}, {{"release.zip", 1}, {"other.zip", 1}},
		{{"release.z01", 1}}, {{"release.7z.001", 1}}, {{"release.zip.001", MaxPackage}, {"release.zip.002", 1}},
	} {
		if _, err := validateUpload(files); err == nil {
			t.Fatalf("无效分卷被接受: %v", files)
		}
	}
}

func TestArchiveReader(t *testing.T) {
	reader := &archiveReader{}
	for _, content := range []string{"abc", "de", "fghij"} {
		file, err := os.CreateTemp(t.TempDir(), "part")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = file.Close() })
		if _, err := file.WriteString(content); err != nil {
			t.Fatal(err)
		}
		reader.files = append(reader.files, file)
		reader.sizes = append(reader.sizes, int64(len(content)))
	}
	for _, tc := range []struct {
		offset int64
		size   int
		want   string
		eof    bool
	}{{0, 10, "abcdefghij", false}, {2, 6, "cdefgh", false}, {3, 2, "de", false}, {8, 5, "ij", true}, {10, 1, "", true}, {10, 0, "", false}} {
		buffer := make([]byte, tc.size)
		n, err := reader.ReadAt(buffer, tc.offset)
		if string(buffer[:n]) != tc.want || (err == io.EOF) != tc.eof || (err != nil && err != io.EOF) {
			t.Fatalf("跨卷读取错误: %+v: %q %v", tc, buffer[:n], err)
		}
	}
}

type uploadStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (s *uploadStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[key] = bytes.Clone(data)
	return nil
}
func (s *uploadStorage) PutReader(ctx context.Context, key string, reader io.ReadSeeker, size int64, mime string) error {
	body, err := io.ReadAll(io.LimitReader(reader, size+1))
	if err != nil || int64(len(body)) != size {
		return fmt.Errorf("流式上传大小无效: %d %v", len(body), err)
	}
	return s.Put(ctx, key, body, mime)
}
func (s *uploadStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.objects[key]
	if !ok {
		return nil, fmt.Errorf("对象不存在: %s", key)
	}
	return io.NopCloser(bytes.NewReader(bytes.Clone(data))), nil
}
func (s *uploadStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	return nil
}
func (s *uploadStorage) Ping(context.Context) error { return nil }

func uploadDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行分卷上传集成测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "import_uploads_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), string(data)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestUploadIntegration(t *testing.T) {
	pool := uploadDatabase(t)
	storage := &uploadStorage{objects: map[string][]byte{}}
	service := NewService(pool, storage)
	identities := identity.NewService(pool, nil, "http://localhost")
	cookies := map[string]*http.Cookie{}
	for _, name := range []string{"admin", "other"} {
		id := resource.ID()
		if _, err := pool.Exec(t.Context(), "INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,'admin')", id, name, name+"@example.com"); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256([]byte(name))
		if _, err := pool.Exec(t.Context(), "INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')", hex.EncodeToString(hash[:]), id); err != nil {
			t.Fatal(err)
		}
		cookies[name] = &http.Cookie{Name: "monkeyai_session", Value: name}
	}
	newRouter := func() http.Handler {
		router := chi.NewRouter()
		router.Use(identities.RequireAdmin)
		NewService(pool, storage).RegisterAdmin(router)
		return router
	}
	router := newRouter()
	call := func(actor, method, path string, body any, status int) []byte {
		t.Helper()
		var raw []byte
		binary, ok := body.([]byte)
		if ok {
			raw = binary
		} else if body != nil {
			raw, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.AddCookie(cookies[actor])
		req.Header.Set("Content-Type", "application/json")
		if ok {
			req.Header.Set("Content-Type", "application/octet-stream")
			req.Header.Set("X-Content-SHA256", digest(raw))
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: 状态 %d，期望 %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	archive := packageFixture(t, func(manifest *Manifest, files map[string][]byte) {
		files["rule.json"] = []byte(`{"content":"演示规则"}`)
		files["connector.json"] = []byte(`{"config":{"url":"https://example.com/mcp"}}`)
		manifest.AgentResources.Rules = []Entry{{Slug: "demo-rule", Name: "演示规则", Path: "rule.json"}}
		manifest.AgentResources.Connectors = []Entry{{Slug: "demo-connector", Name: "演示连接器", Path: "connector.json"}}
	})
	input := resource.Object{"files": []UploadFile{{"release.zip.001", int64(len(archive) / 2)}, {"release.zip.002", int64(len(archive) - len(archive)/2)}}}
	var upload Upload
	if err := json.Unmarshal(call("admin", "POST", "/resource-import-uploads", input, 201), &upload); err != nil {
		t.Fatal(err)
	}
	path := "/resource-import-uploads/" + upload.ID
	call("other", "GET", path, nil, 404)
	call("other", "PUT", path+"/chunks/0", archive, 404)
	call("admin", "POST", path+"/complete", nil, 400)
	call("admin", "PUT", path+"/chunks/1", archive, 400)
	call("admin", "PUT", path+"/chunks/0", archive, 204)
	call("admin", "PUT", path+"/chunks/0", archive, 204)
	call("admin", "PUT", path+"/chunks/0", bytes.Repeat([]byte("x"), len(archive)), 409)
	// 新建处理器模拟进程重启，上传内容和进度不依赖进程内存。
	router = newRouter()
	var resumed Upload
	if err := json.Unmarshal(call("admin", "GET", path, nil, 200), &resumed); err != nil || len(resumed.Chunks) != 1 {
		t.Fatalf("上传进度未恢复: %+v %v", resumed, err)
	}
	call("admin", "POST", "/resource-imports/preview", importInput{UploadID: upload.ID}, 400)
	call("admin", "POST", path+"/complete", nil, 200)
	call("admin", "POST", path+"/complete", nil, 200)
	call("admin", "PUT", path+"/chunks/0", archive, 409)
	var preview Preview
	if err := json.Unmarshal(call("admin", "POST", "/resource-imports/preview", importInput{UploadID: upload.ID}, 200), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.PackageSHA256 != digest(archive) || len(preview.Changes) != 3 {
		t.Fatalf("分卷预览与完整 ZIP 不符: %+v", preview)
	}
	for _, change := range preview.Changes {
		if change.Action != "create" {
			t.Fatalf("首次导入应新增资源: %+v", change)
		}
	}
	call("other", "POST", "/resource-imports/preview", importInput{UploadID: upload.ID}, 404)
	apply := importInput{UploadID: upload.ID, Options: Options{ConfirmFinal: true, AuthorizationModes: map[string]string{}}, PackageSHA256: preview.PackageSHA256, PlanDigest: "stale"}
	call("admin", "POST", "/resource-imports", apply, 409)
	apply.PlanDigest = preview.PlanDigest
	apply.Options.ConfirmFinal = false
	call("admin", "POST", "/resource-imports", apply, 400)
	apply.Options.ConfirmFinal = true
	call("admin", "POST", "/resource-imports", apply, 200)
	var imported Upload
	_ = json.Unmarshal(call("admin", "GET", path, nil, 200), &imported)
	if imported.Status != "imported" {
		t.Fatalf("导入任务状态未更新: %+v", imported)
	}
	var count int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM resource_imports").Scan(&count); err != nil || count != 1 {
		t.Fatalf("分卷应只产生一个批次: %d %v", count, err)
	}
	t.Run("外部Expert引用的缺失资源自动保留", func(t *testing.T) {
		expertID := "d02112c9-1a1a-43bb-9757-5c354eefe4e7"
		if _, err := pool.Exec(t.Context(), `INSERT INTO experts(id,name,description,prompt,created_by_user_id,owner_user_id)
			SELECT $1,'外部研究助手','','',owner_user_id,owner_user_id FROM skills LIMIT 1`, expertID); err != nil {
			t.Fatal(err)
		}
		for _, kind := range []string{"skill", "rule", "connector"} {
			if _, err := pool.Exec(t.Context(), fmt.Sprintf("INSERT INTO expert_%ss(expert_id,%s_id) SELECT $1,id FROM %ss LIMIT 1", kind, kind, kind), expertID); err != nil {
				t.Fatal(err)
			}
		}
		localExpertID := resource.ID()
		if _, err := pool.Exec(t.Context(), `INSERT INTO experts(id,name,description,prompt,created_by_user_id,owner_user_id)
			SELECT $1,'本发布者旧专家','','',owner_user_id,owner_user_id FROM skills LIMIT 1`, localExpertID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id)
			SELECT publisher,'old-expert','expert',$1,source_sha256,applied_sha256,last_import_id
			FROM resource_import_bindings WHERE resource_type='skill'`, localExpertID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), "INSERT INTO expert_skills(expert_id,skill_id) SELECT $1,id FROM skills LIMIT 1", localExpertID); err != nil {
			t.Fatal(err)
		}
		snapshot := func() string {
			t.Helper()
			var value string
			if err := pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
				'skills',(SELECT jsonb_agg(to_jsonb(s)) FROM skills s),
				'rules',(SELECT jsonb_agg(to_jsonb(r)) FROM rules r),
				'connectors',(SELECT jsonb_agg(to_jsonb(c)) FROM connectors c),
				'bindings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY slug) FROM resource_import_bindings b WHERE resource_type<>'expert'),
				'expert_skills',(SELECT jsonb_agg(to_jsonb(l)) FROM expert_skills l),
				'expert_rules',(SELECT jsonb_agg(to_jsonb(l)) FROM expert_rules l),
				'expert_connectors',(SELECT jsonb_agg(to_jsonb(l)) FROM expert_connectors l))::text`).Scan(&value); err != nil {
				t.Fatal(err)
			}
			return value
		}
		before := snapshot()
		removed := packageFixture(t, func(manifest *Manifest, _ map[string][]byte) { manifest.AgentResources.Skills = nil })
		pkg, err := ParseReader(bytes.NewReader(removed), int64(len(removed)))
		if err != nil {
			t.Fatal(err)
		}
		items, err := ParseResources(pkg)
		if err != nil {
			t.Fatal(err)
		}
		preview, err := service.Evaluate(t.Context(), pool, pkg, items, Options{}, digest(removed))
		if err != nil || len(preview.Changes) != 4 || !preview.RequiresConfirm {
			t.Fatalf("保留资源应可与旧专家停用同时预览: %+v %v", preview, err)
		}
		for _, change := range preview.Changes {
			if change.Type == "expert" {
				if change.Action != "retire" {
					t.Fatalf("本发布者缺失专家应正常停用: %+v", change)
				}
				continue
			}
			if change.Action != "retain" || len(change.Warnings) != 1 || !strings.Contains(change.Warnings[0], "外部研究助手") || !strings.Contains(change.Warnings[0], expertID) {
				t.Fatalf("未显示资源保留原因: %+v", change)
			}
		}
		var retainedUpload Upload
		if err := json.Unmarshal(call("admin", "POST", "/resource-import-uploads", resource.Object{"files": []UploadFile{{"removed.zip", int64(len(removed))}}}, 201), &retainedUpload); err != nil {
			t.Fatal(err)
		}
		retainedPath := "/resource-import-uploads/" + retainedUpload.ID
		call("admin", "PUT", retainedPath+"/chunks/0", removed, 204)
		call("admin", "POST", retainedPath+"/complete", nil, 200)
		request := importInput{UploadID: retainedUpload.ID, Options: Options{ConfirmFinal: true}, PackageSHA256: preview.PackageSHA256, PlanDigest: preview.PlanDigest}
		call("admin", "POST", "/resource-imports", request, 200)
		if after := snapshot(); before != after {
			t.Fatalf("保留资源时不应修改内容、版本、绑定或引用:\n前: %s\n后: %s", before, after)
		}
		var localEnabled bool
		if err := pool.QueryRow(t.Context(), "SELECT enabled FROM experts WHERE id=$1", localExpertID).Scan(&localEnabled); err != nil || localEnabled {
			t.Fatalf("保留资源不应阻止本发布者旧专家停用: %t %v", localEnabled, err)
		}
		var retained int
		if err := pool.QueryRow(t.Context(), "SELECT (result_counts->>'retain')::int FROM resource_imports ORDER BY version DESC LIMIT 1").Scan(&retained); err != nil || retained != 3 {
			t.Fatalf("未记录保留数量: %d %v", retained, err)
		}
		if _, err := pool.Exec(t.Context(), "UPDATE experts SET enabled=false WHERE id=$1", expertID); err != nil {
			t.Fatal(err)
		}
		request.PlanDigest = preview.PlanDigest
		call("admin", "POST", "/resource-imports", request, 409)
		preview, err = service.Evaluate(t.Context(), pool, pkg, items, Options{}, digest(removed))
		if err != nil || len(preview.Changes) != 3 {
			t.Fatalf("解除有效引用后应允许预览停用: %+v %v", preview, err)
		}
		for _, change := range preview.Changes {
			if change.Action != "retire" {
				t.Fatalf("解除有效引用后应恢复正常停用计划: %+v", change)
			}
		}
	})
	if _, err := pool.Exec(t.Context(), "UPDATE resource_import_uploads SET expires_at=now()-interval '1 second' WHERE id=$1", upload.ID); err != nil {
		t.Fatal(err)
	}
	call("admin", "GET", path, nil, 404)
	if err := service.CleanupUploads(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, found := storage.objects[upload.chunkKey(0)]; found {
		t.Fatal("过期上传块未清理")
	}
	var cancelled Upload
	_ = json.Unmarshal(call("admin", "POST", "/resource-import-uploads", input, 201), &cancelled)
	call("admin", "DELETE", "/resource-import-uploads/"+cancelled.ID, nil, 204)
	call("admin", "GET", "/resource-import-uploads/"+cancelled.ID, nil, 404)
	if err := service.CleanupUploads(t.Context()); err != nil {
		t.Fatal(err)
	}
	var list struct {
		Items []Upload `json:"items"`
	}
	_ = json.Unmarshal(call("admin", "GET", "/resource-import-uploads", nil, 200), &list)
	if !reflect.DeepEqual(list.Items, []Upload{}) {
		t.Fatalf("已完成和已取消任务不应显示为未完成: %+v", list)
	}
}
