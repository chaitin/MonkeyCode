package resourceimport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type designStorage struct{ *uploadStorage }

func (s *designStorage) PutImmutable(ctx context.Context, key string, r io.ReadSeeker, size int64, mime, sha string) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	if int64(len(b)) != size || digest(b) != sha {
		return errors.New("invalid immutable object")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.objects[key]; ok && !bytes.Equal(old, b) {
		return errors.New("immutable conflict")
	}
	s.objects[key] = b
	return nil
}
func (s *designStorage) HeadImmutable(_ context.Context, key string) (int64, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.objects[key]
	if !ok {
		return 0, "", os.ErrNotExist
	}
	return int64(len(b)), digest(b), nil
}
func (s *designStorage) GetRange(ctx context.Context, key string, start, end int64) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.objects[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	if start < 0 || end >= int64(len(b)) || start > end {
		return nil, errors.New("invalid range")
	}
	return io.NopCloser(bytes.NewReader(bytes.Clone(b[start : end+1]))), nil
}

type failingCatalog struct {
	*designcatalog.Service
	fail bool
}

func (c *failingCatalog) Prepare(ctx context.Context, p *designcatalog.Package) error {
	if c.fail {
		return errors.New("storage failure")
	}
	return c.Service.Prepare(ctx, p)
}

func TestImportLoadBudgetAndCancellation(t *testing.T) {
	raw := packageFixture(t, nil)
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("package", "legacy.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(raw); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	service := &Service{importSlots: make(chan struct{}, 1)}
	request := httptest.NewRequest("POST", "/resource-imports/preview", &buf)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	loaded, err := service.loadImport(httptest.NewRecorder(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(service.importSlots) != 1 {
		t.Fatal("拼接和解析阶段未持有导入预算")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.loadImport(httptest.NewRecorder(), httptest.NewRequest("POST", "/resource-imports/preview", nil).WithContext(ctx))
	if !errors.Is(err, context.Canceled) {
		t.Fatal("等待预算时未响应取消", err)
	}
	loaded.cleanup()
	loaded.cleanup()
	if len(service.importSlots) != 0 {
		t.Fatal("导入预算未释放")
	}
}

func TestDesignSectionsIntegration(t *testing.T) {
	pool := uploadDatabase(t)
	store := &designStorage{&uploadStorage{objects: map[string][]byte{}}}
	catalog := &failingCatalog{Service: designcatalog.NewService(pool, store)}
	s := NewService(pool, store).WithDesignCatalog(catalog)
	actor := resource.ID()
	if _, err := pool.Exec(t.Context(), "INSERT INTO users(id,name,email,role) VALUES($1,'admin','design-sections@example.com','admin')", actor); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("design-session"))
	if _, err := pool.Exec(t.Context(), "INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')", hex.EncodeToString(hash[:]), actor); err != nil {
		t.Fatal(err)
	}
	ids := identity.NewService(pool, nil, "http://localhost")
	router := chi.NewRouter()
	router.Use(ids.RequireAdmin)
	s.RegisterAdmin(router)
	call := func(method, path string, body any, status int) []byte {
		t.Helper()
		var b []byte
		if raw, ok := body.([]byte); ok {
			b = raw
		} else if body != nil {
			b, _ = json.Marshal(body)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: "design-session"})
		r.Header.Set("Content-Type", "application/json")
		if _, ok := body.([]byte); ok {
			r.Header.Set("Content-Type", "application/octet-stream")
			r.Header.Set("X-Content-SHA256", digest(b))
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: got %d expected %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	upload := func(raw []byte) Upload {
		t.Helper()
		var u Upload
		if err := json.Unmarshal(call("POST", "/resource-import-uploads", resource.Object{"files": []UploadFile{{"release.zip", int64(len(raw))}}}, 201), &u); err != nil {
			t.Fatal(err)
		}
		call("PUT", "/resource-import-uploads/"+u.ID+"/chunks/0", raw, 204)
		if err := json.Unmarshal(call("POST", "/resource-import-uploads/"+u.ID+"/complete", nil, 200), &u); err != nil {
			t.Fatal(err)
		}
		return u
	}
	preview := func(u Upload, sections []string) Preview {
		t.Helper()
		var p Preview
		if err := json.Unmarshal(call("POST", "/resource-imports/preview", importInput{UploadID: u.ID, Sections: sections}, 200), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	apply := func(u Upload, p Preview, status int) SectionResults {
		t.Helper()
		digests := map[string]string{}
		for k, v := range p.SectionPlans {
			digests[k] = v.PlanDigest
		}
		var result SectionResults
		b := call("POST", "/resource-imports", importInput{UploadID: u.ID, Sections: p.Sections, PackageSHA256: p.PackageSHA256, PlanDigest: p.PlanDigest, SectionPlanDigests: digests, Options: Options{ConfirmFinal: true}}, status)
		if status == 200 {
			if err := json.Unmarshal(b, &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	legacy := packageFixture(t, nil)
	files, err := readZIP(legacy, MaxPackage, MaxExpanded, MaxFile)
	if err != nil {
		t.Fatal(err)
	}
	var rel Release
	_ = json.Unmarshal(files["release.json"], &rel)
	rel.Publisher.Name = "fixture"
	files["release.json"], _ = json.Marshal(rel)
	legacy, err = makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	oldUpload := upload(legacy)
	oldPreview := preview(oldUpload, nil)
	call("POST", "/resource-imports", importInput{UploadID: oldUpload.ID, PackageSHA256: oldPreview.PackageSHA256, PlanDigest: oldPreview.PlanDigest, Options: Options{ConfirmFinal: true}}, 200)
	raw, err := os.ReadFile("../../testdata/design-contract/v1/release.zip")
	if err != nil {
		t.Fatal(err)
	}
	u := upload(raw)
	call("POST", "/resource-imports/preview", importInput{UploadID: u.ID}, 400)
	discovery := call("POST", "/resource-imports/preview", importInput{UploadID: u.ID, DiscoverOnly: true}, 200)
	if !bytes.Contains(discovery, []byte("available_sections")) {
		t.Fatal("缺少分区发现")
	}
	p := preview(u, []string{"design"})
	if len(p.Changes) != 0 {
		t.Fatal("设计-only 包产生 Agent 变更")
	}
	result := apply(u, p, 200)
	if result.Status != "succeeded" {
		t.Fatalf("设计导入失败: %+v", result)
	}
	var enabled bool
	if err = pool.QueryRow(t.Context(), "SELECT enabled FROM skills WHERE name='demo-skill'").Scan(&enabled); err != nil || !enabled {
		t.Fatalf("设计-only 误退役 Agent: %v", err)
	}
	current, revision, err := catalog.Current(t.Context())
	if err != nil || revision != 1 {
		t.Fatal("current错误", err)
	}
	if current.ReleaseID != "70000000-0000-0000-0000-000000000001" {
		t.Fatal("源 release 被重写")
	}
	replay := apply(u, p, 200)
	if !replay.Sections["design"].Replayed {
		t.Fatal("重放未使用成功回执")
	}
	_, after, _ := catalog.Current(t.Context())
	if after != revision {
		t.Fatal("重放重新激活")
	}
	var state string
	if err = pool.QueryRow(t.Context(), "SELECT status FROM resource_import_uploads WHERE id=$1", u.ID).Scan(&state); err != nil || state != "ready" {
		t.Fatal("单分区成功不应结束上传", state, err)
	}
	second := preview(u, []string{"agent"})
	apply(u, second, 200)
	if err = pool.QueryRow(t.Context(), "SELECT status FROM resource_import_uploads WHERE id=$1", u.ID).Scan(&state); err != nil || state != "imported" {
		t.Fatal("分区补全后上传未完成", state, err)
	}
	mixed := upload(raw)
	catalog.fail = true
	mp := preview(mixed, []string{"agent", "design"})
	partial := apply(mixed, mp, 200)
	if partial.Status != "partial" || partial.Sections["agent"].Status != "succeeded" || partial.Sections["design"].Status != "failed" {
		t.Fatalf("部分成功错误: %+v", partial)
	}
	_, unchanged, _ := catalog.Current(t.Context())
	if unchanged != revision {
		t.Fatal("失败设计切换current")
	}
	catalog.fail = false
	dp := preview(mixed, []string{"design"})
	apply(mixed, dp, 200)
	_, newRevision, _ := catalog.Current(t.Context())
	if newRevision != revision+1 {
		t.Fatal("失败分区重试未激活")
	}
	apply(mixed, dp, 200)
	_, again, _ := catalog.Current(t.Context())
	if again != newRevision {
		t.Fatal("重试后重放改变current")
	}
	history := call("GET", "/resource-imports", nil, 200)
	if !bytes.Contains(history, []byte("section_results")) {
		t.Fatal("设计分区结果未进入导入历史")
	}
	if _, err = pool.Exec(t.Context(), "UPDATE resource_import_uploads SET expires_at=now()-interval '1 hour' WHERE id=$1", mixed.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.CleanupUploads(t.Context()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM resource_import_sections WHERE upload_id=$1", mixed.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("过期清理删除分区历史", count, err)
	}
}
