package designcatalog

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"uuid"

	"github.com/jackc/pgx/v5/pgxpool"
)

type memoryStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	fail    bool
}

func newStorage() *memoryStorage { return &memoryStorage{objects: map[string][]byte{}} }
func (m *memoryStorage) PutImmutable(_ context.Context, key string, r io.ReadSeeker, size int64, mime, sha string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail {
		return errors.New("storage unavailable")
	}
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	if int64(len(b)) != size || Hash(b) != sha {
		return errors.New("immutable hash mismatch")
	}
	if old, ok := m.objects[key]; ok && !bytes.Equal(old, b) {
		return errors.New("immutable conflict")
	}
	m.objects[key] = b
	return nil
}
func (m *memoryStorage) HeadImmutable(_ context.Context, key string) (int64, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.objects[key]
	if !ok {
		return 0, "", os.ErrNotExist
	}
	return int64(len(b)), Hash(b), nil
}
func (m *memoryStorage) GetRange(_ context.Context, key string, start, end int64) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.objects[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	if start < 0 || end >= int64(len(b)) || start > end {
		return nil, errors.New("invalid range")
	}
	return io.NopCloser(bytes.NewReader(bytes.Clone(b[start : end+1]))), nil
}
func designDatabase(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行设计快照集成测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "design_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	if _, err = root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migrations, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range migrations {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), string(b)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	actor := uuid.New().String()
	if _, err = pool.Exec(t.Context(), "INSERT INTO users(id,name,email,role) VALUES($1,'design','design@example.com','admin')", actor); err != nil {
		t.Fatal(err)
	}
	return pool, actor
}
func fixture(t *testing.T) *Package {
	t.Helper()
	p, err := ParseFile(t.Context(), "../../testdata/design-contract/v1/release.zip")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func TestSnapshotPersistence(t *testing.T) {
	pool, actor := designDatabase(t)
	store := newStorage()
	s := NewService(pool, store)
	p := fixture(t)
	if err := s.Prepare(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	apply := func(p *Package, expected string) error {
		tx, err := pool.Begin(t.Context())
		if err != nil {
			return err
		}
		defer tx.Rollback(context.Background())
		_, err = s.Apply(t.Context(), tx, p, actor, expected)
		if err != nil {
			return err
		}
		return tx.Commit(t.Context())
	}
	plan, err := s.Plan(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	if err = apply(p, plan.PlanDigest); err != nil {
		t.Fatal(err)
	}
	r1, err := s.Find(t.Context(), p.PublisherID, p.ReleaseID)
	if err != nil || len(r1.Entries) != 5 {
		t.Fatalf("R1: %v", err)
	}
	p.ReleaseID = "70000000-0000-0000-0000-000000000002"
	p2plan, err := s.Plan(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	if err = apply(p, plan.PlanDigest); err == nil {
		t.Fatal("过期计划应拒绝")
	}
	if err = apply(p, p2plan.PlanDigest); err != nil {
		t.Fatal(err)
	}
	current, rev, err := s.Current(t.Context())
	if err != nil || current.ReleaseID != p.ReleaseID || rev != 2 {
		t.Fatalf("current: %+v %d %v", current, rev, err)
	}
	old, err := s.Find(t.Context(), p.PublisherID, r1.ReleaseID)
	if err != nil || old.Digest != r1.Digest {
		t.Fatal("历史快照被修改", err)
	}
	p.Taxonomy.Categories[0].Count++
	if _, err = s.Plan(t.Context(), p); err == nil {
		t.Fatal("同 release 修改 taxonomy 未拒绝")
	}
	p.Taxonomy.Categories[0].Count--
	p.ReleaseID = "70000000-0000-0000-0000-000000000003"
	failurePlan, err := s.Plan(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	p.Entries[0].Native = nil
	if err = apply(p, failurePlan.PlanDigest); err == nil {
		t.Fatal("缺失 native 对象未拒绝")
	}
	after, rev2, err := s.Current(t.Context())
	if err != nil || after.ReleaseID != current.ReleaseID || rev2 != rev {
		t.Fatal("失败切换了 current")
	}
	if _, err = s.Find(t.Context(), p.PublisherID, p.ReleaseID); err == nil {
		t.Fatal("回滚后仍留下快照")
	}
}
func TestStorageNativeZIP(t *testing.T) {
	store := newStorage()
	s := NewService(nil, store)
	p := fixture(t)
	if err := s.Prepare(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	e := p.Entry("template", "sample.bundle")
	before := *e.Native
	raw := store.objects[e.Native.Key]
	if Hash(raw) != e.Native.SHA256 {
		t.Fatal("native ETag 不是实际字节SHA")
	}
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		if f.Name == "template.json._source" || strings.HasPrefix(f.Name, ".prompts/") {
			t.Fatal("发布元数据混入 native ZIP")
		}
	}
	f, err := z.Open("template.json")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(f)
	f.Close()
	if string(body) != "upstream template\n" {
		t.Fatal("原始源文件被覆盖")
	}
	if err = s.Prepare(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	if *e.Native != before {
		t.Fatal("重复生成 native ZIP 不确定")
	}
	count := len(store.objects)
	store.fail = true
	if err = s.Prepare(t.Context(), p); err == nil {
		t.Fatal("存储失败被忽略")
	}
	if len(store.objects) != count {
		t.Fatal("失败删除了历史共享对象")
	}
}
func TestCorruptSnapshotRead(t *testing.T) {
	pool, actor := designDatabase(t)
	s := NewService(pool, newStorage())
	p := fixture(t)
	if err := s.Prepare(t.Context(), p); err != nil {
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
	defer tx.Rollback(t.Context())
	if _, err = s.Apply(t.Context(), tx, p, actor, plan.PlanDigest); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), "UPDATE design_entries SET data=jsonb_set(data,'{metadata,name}',to_jsonb('damaged'::text)) WHERE resource_type='template' AND catalog_id='sample.bundle'"); err != nil {
		t.Fatal(err)
	}
	_, err = s.Find(t.Context(), p.PublisherID, p.ReleaseID)
	var f *Fault
	if !errors.As(err, &f) || f.Status != 503 {
		t.Fatalf("损坏快照未明确拒绝: %v", err)
	}
}

func TestConcurrentActivation(t *testing.T) {
	pool, actor := designDatabase(t)
	s := NewService(pool, newStorage())
	p := fixture(t)
	if err := s.Prepare(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	plan, err := s.Plan(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			tx, err := pool.Begin(t.Context())
			if err != nil {
				results <- err
				return
			}
			defer tx.Rollback(context.Background())
			_, err = s.Apply(t.Context(), tx, p, actor, plan.PlanDigest)
			if err == nil {
				err = tx.Commit(t.Context())
			}
			results <- err
		})
	}
	wg.Wait()
	close(results)
	success := 0
	conflict := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			var f *Fault
			if errors.As(err, &f) && f.Status == 409 {
				conflict++
			} else {
				t.Fatal(err)
			}
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("并发结果 %d/%d", success, conflict)
	}
}
