package agentresource

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ---- fake ObjectStore -----------------------------------------------------

// fakeObjectStore is a thread-safe in-memory ObjectStore. Keys mapped in
// errFor return that error; otherwise the byte slice under data is wrapped
// in an io.NopCloser.
type fakeObjectStore struct {
	mu     sync.Mutex
	data   map[string][]byte
	errFor map[string]error
}

func newFakeObjectStore() *fakeObjectStore {
	return &fakeObjectStore{
		data:   map[string][]byte{},
		errFor: map[string]error{},
	}
}

func (f *fakeObjectStore) put(key string, body []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.data[key] = body
}

func (f *fakeObjectStore) GetObject(_ context.Context, key string) (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err, ok := f.errFor[key]; ok {
		return nil, err
	}
	body, ok := f.data[key]
	if !ok {
		return nil, errors.New("fake: key not found: " + key)
	}
	return io.NopCloser(bytes.NewReader(body)), nil
}

// PresignGet returns a deterministic fake URL ("https://fake/<key>") so
// SkillRefs / PluginRefs tests can assert without touching real S3. Keys
// registered in errFor return that error instead.
func (f *fakeObjectStore) PutFile(_ context.Context, prefix, filename string, body io.Reader) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	f.put(prefix+"/"+filename, data)
	return nil
}

func (f *fakeObjectStore) PresignGet(_ context.Context, key string, _ time.Duration) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err, ok := f.errFor[key]; ok {
		return "", err
	}
	return "https://fake/" + key, nil
}

// ---- fake Repo ------------------------------------------------------------

type fakeRepo struct {
	rules        []*RuleWithVersion
	rulesErr     error
	skills       []*SkillWithVersion
	skillsErr    error
	plugins      []*PluginWithVersion
	pluginsErr   error
	lastSkillIDs []uuid.UUID
	lastPlugIDs  []uuid.UUID
}

func (f *fakeRepo) ListActiveRules(_ context.Context) ([]*RuleWithVersion, error) {
	return f.rules, f.rulesErr
}
func (f *fakeRepo) ListActiveSkills(_ context.Context, ids []uuid.UUID) ([]*SkillWithVersion, error) {
	f.lastSkillIDs = ids
	return f.skills, f.skillsErr
}
func (f *fakeRepo) ListActivePlugins(_ context.Context, ids []uuid.UUID) ([]*PluginWithVersion, error) {
	f.lastPlugIDs = ids
	return f.plugins, f.pluginsErr
}
func (f *fakeRepo) ListSkillsForListing(_ context.Context) ([]*ResourceListItem, error) {
	return nil, nil
}
func (f *fakeRepo) ListPluginsForListing(_ context.Context) ([]*ResourceListItem, error) {
	return nil, nil
}
func (f *fakeRepo) ListSkillsForListingScoped(_ context.Context, _ ScopeFilter) ([]*ResourceListItem, error) {
	return nil, nil
}
func (f *fakeRepo) ListPluginsForListingScoped(_ context.Context, _ ScopeFilter) ([]*ResourceListItem, error) {
	return nil, nil
}
func (f *fakeRepo) ListActiveSkillsScoped(_ context.Context, sel SkillSelection) ([]*SkillWithVersion, error) {
	f.lastSkillIDs = sel.UserSelectedIDs
	return f.skills, f.skillsErr
}
func (f *fakeRepo) ListActivePluginsScoped(_ context.Context, sel SkillSelection) ([]*PluginWithVersion, error) {
	f.lastPlugIDs = sel.UserSelectedIDs
	return f.plugins, f.pluginsErr
}

// ---- rules ----------------------------------------------------------------

func TestRules_HappyPath_TwoRules(t *testing.T) {
	// Rule resolver reads content directly from the repo (DB) — no S3 fetch
	// is performed, so we don't seed the fake objectstore here.
	repo := &fakeRepo{rules: []*RuleWithVersion{
		{Name: "a", Content: "body-a"},
		{Name: "b", Content: "body-b"},
	}}
	r := NewResolver(repo, newFakeObjectStore(), nil)

	got, err := r.Rules(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 rules, got %d", len(got))
	}
	if got[0].Name != "a" || got[0].Content != "body-a" {
		t.Errorf("rule[0] = %+v", got[0])
	}
	if got[1].Name != "b" || got[1].Content != "body-b" {
		t.Errorf("rule[1] = %+v", got[1])
	}
}

func TestRules_RepoErrorPropagates(t *testing.T) {
	repo := &fakeRepo{rulesErr: errors.New("db down")}
	r := NewResolver(repo, newFakeObjectStore(), nil)
	_, err := r.Rules(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
}

// ---- skills ---------------------------------------------------------------

func TestSkills_UnzipPreservesRelPaths(t *testing.T) {
	zipBytes := buildZip(t, map[string]string{
		"skill.md":       "S",
		"scripts/run.sh": "R",
	})
	os := newFakeObjectStore()
	os.put("skills/k.zip", zipBytes)

	repo := &fakeRepo{skills: []*SkillWithVersion{
		{Name: "k", S3Key: "skills/k.zip"},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Skills(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Name != "k" {
		t.Fatalf("unexpected assets: %+v", got)
	}
	rel := map[string]string{}
	for _, f := range got[0].Files {
		rel[f.RelPath] = string(f.Content)
	}
	if rel["skill.md"] != "S" || rel["scripts/run.sh"] != "R" {
		t.Errorf("relpaths = %+v", rel)
	}
}

func TestSkills_ZipBombGuard_FileTooBig_SkipsAsset(t *testing.T) {
	// good skill is fine; bad skill has one entry > MaxFileSize.
	good := buildZip(t, map[string]string{"ok.md": "ok"})

	// 33 MiB of data — just over the 32 MiB default.
	huge := bytes.Repeat([]byte("A"), int(DefaultUnzipLimits.MaxFileSize)+1024)
	bad := buildZip(t, map[string]string{"big.bin": string(huge)})

	os := newFakeObjectStore()
	os.put("skills/good.zip", good)
	os.put("skills/bad.zip", bad)

	repo := &fakeRepo{skills: []*SkillWithVersion{
		{Name: "good", S3Key: "skills/good.zip"},
		{Name: "bad", S3Key: "skills/bad.zip"},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Skills(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Name != "good" {
		t.Fatalf("want only good skill, got %+v", got)
	}
}

func TestSkills_ZipSlip_Reject(t *testing.T) {
	bad := buildZip(t, map[string]string{"../evil": "x"})
	good := buildZip(t, map[string]string{"a.md": "a"})

	os := newFakeObjectStore()
	os.put("skills/bad.zip", bad)
	os.put("skills/good.zip", good)

	repo := &fakeRepo{skills: []*SkillWithVersion{
		{Name: "bad", S3Key: "skills/bad.zip"},
		{Name: "good", S3Key: "skills/good.zip"},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Skills(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Name != "good" {
		t.Fatalf("want only good skill, got %+v", got)
	}
}

func TestSkills_UserSelectedUnion(t *testing.T) {
	// Repo simulates the union itself; the resolver just needs to forward
	// the IDs verbatim and materialize whatever the repo returned.
	userID := uuid.New()
	forceID := uuid.New()

	zipBytes := buildZip(t, map[string]string{"x.md": "x"})
	os := newFakeObjectStore()
	os.put("u.zip", zipBytes)
	os.put("f.zip", zipBytes)

	repo := &fakeRepo{skills: []*SkillWithVersion{
		{ID: userID, Name: "user-skill", S3Key: "u.zip"},
		{ID: forceID, Name: "force-skill", S3Key: "f.zip", IsForceDelivery: true},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Skills(context.Background(), []uuid.UUID{userID})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 skills, got %d", len(got))
	}
	names := []string{got[0].Name, got[1].Name}
	sort.Strings(names)
	if names[0] != "force-skill" || names[1] != "user-skill" {
		t.Errorf("names = %v", names)
	}
	if len(repo.lastSkillIDs) != 1 || repo.lastSkillIDs[0] != userID {
		t.Errorf("repo received IDs = %v, want [%v]", repo.lastSkillIDs, userID)
	}
}

// ---- plugins --------------------------------------------------------------

func TestPlugins_EntryFieldPreserved(t *testing.T) {
	zipBytes := buildZip(t, map[string]string{"main.js": "console.log(1)"})
	os := newFakeObjectStore()
	os.put("plugins/p.zip", zipBytes)

	repo := &fakeRepo{plugins: []*PluginWithVersion{
		{Name: "p", S3Key: "plugins/p.zip", Entry: "main.js"},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Plugins(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 plugin, got %d", len(got))
	}
	if got[0].Entry != "main.js" {
		t.Errorf("entry = %q", got[0].Entry)
	}
	if len(got[0].Files) != 1 || got[0].Files[0].RelPath != "main.js" {
		t.Errorf("files = %+v", got[0].Files)
	}
}

func TestPlugins_EmptyIDs_OnlyForce(t *testing.T) {
	zipBytes := buildZip(t, map[string]string{"m.js": "x"})
	os := newFakeObjectStore()
	os.put("only.zip", zipBytes)

	repo := &fakeRepo{plugins: []*PluginWithVersion{
		{Name: "force-only", S3Key: "only.zip", IsForceDelivery: true, Entry: "m.js"},
	}}
	r := NewResolver(repo, os, nil)

	got, err := r.Plugins(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Name != "force-only" {
		t.Fatalf("got %+v", got)
	}
	if len(repo.lastPlugIDs) != 0 {
		t.Errorf("repo received IDs = %v, want empty", repo.lastPlugIDs)
	}
}
