package designcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Fault struct {
	Status  int
	Code    string
	Message string
}

func (e *Fault) Error() string                     { return e.Message }
func fault(status int, code, message string) error { return &Fault{status, code, message} }
func Conflict(message string) error                { return fault(409, "import_conflict", message) }

type Service struct {
	pool    *pgxpool.Pool
	storage Storage
	access  AccessConfig
	devices DeviceOwner
}

func NewService(pool *pgxpool.Pool, storage Storage) *Service {
	return &Service{pool: pool, storage: storage}
}
func (s *Service) WithAccess(cfg AccessConfig) *Service     { s.access = cfg; return s }
func (s *Service) WithDevices(devices DeviceOwner) *Service { s.devices = devices; return s }

type Change struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Name   string `json:"name"`
	Action string `json:"action"`
}
type Plan struct {
	SnapshotRef
	PlanDigest      string         `json:"plan_digest"`
	SnapshotDigest  string         `json:"snapshot_digest"`
	CurrentRevision int64          `json:"current_revision"`
	Counts          map[string]int `json:"counts"`
	Changes         []Change       `json:"changes"`
}
type Snapshot struct {
	SnapshotRef
	ID       string
	Digest   string
	Entries  []Entry
	Taxonomy Taxonomy
}

func payload(v any) []byte { b, _ := json.Marshal(v); return b }
func (s *Service) Current(ctx context.Context) (*SnapshotRef, int64, error) {
	row, err := sqlc.New(s.pool).Current(ctx)
	if err != nil {
		return nil, 0, err
	}
	if row.SourceReleaseID == nil || row.PublisherID == nil {
		return nil, row.Revision, nil
	}
	return &SnapshotRef{*row.PublisherID, *row.SourceReleaseID, SchemaVersion, DigestSchema}, row.Revision, nil
}
func snapshot(ctx context.Context, q *sqlc.Queries, publisher, release string) (*Snapshot, error) {
	row, err := q.Snapshot(ctx, sqlc.SnapshotParams{PublisherID: publisher, SourceReleaseID: release})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fault(404, "snapshot_not_found", "指定快照不存在")
	}
	if err != nil {
		return nil, err
	}
	out := &Snapshot{SnapshotRef: SnapshotRef{row.PublisherID, row.SourceReleaseID, int(row.SchemaVersion), row.DigestSchema}, ID: row.ID, Digest: row.SnapshotDigest, Entries: []Entry{}}
	if err = json.Unmarshal(row.Taxonomy, &out.Taxonomy); err != nil {
		return nil, err
	}
	rows, err := q.Entries(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	for _, data := range rows {
		var e Entry
		if err = json.Unmarshal(data, &e); err != nil {
			return nil, err
		}
		if digest, checkErr := ContentDigest(e); checkErr != nil || digest != e.ContentDigest {
			return nil, fault(503, "unavailable", "快照资源元数据损坏")
		}
		out.Entries = append(out.Entries, e)
	}
	computed, checkErr := (&Package{SnapshotRef: out.SnapshotRef, Entries: out.Entries, Taxonomy: out.Taxonomy}).Digest()
	if checkErr != nil || computed != out.Digest {
		return nil, fault(503, "unavailable", "快照指纹损坏")
	}
	return out, nil
}
func (s *Service) Find(ctx context.Context, publisher, release string) (*Snapshot, error) {
	return snapshot(ctx, sqlc.New(s.pool), publisher, release)
}
func (s *Service) Plan(ctx context.Context, p *Package) (Plan, error) {
	return s.plan(ctx, sqlc.New(s.pool), p)
}
func (s *Service) plan(ctx context.Context, q *sqlc.Queries, p *Package) (Plan, error) {
	out := Plan{SnapshotRef: p.SnapshotRef, Counts: map[string]int{"template": 0, "design-system": 0, "style": 0, "direction": 0}, Changes: []Change{}}
	if s.access.PublisherID != "" && s.access.PublisherID != p.PublisherID {
		return out, Conflict("资源包发布者与部署配置不匹配")
	}
	current, err := q.Current(ctx)
	if err != nil {
		return out, err
	}
	out.CurrentRevision = current.Revision
	if current.PublisherID != nil && *current.PublisherID != p.PublisherID {
		return out, Conflict("当前部署已绑定其他设计发布者")
	}
	out.SnapshotDigest, err = p.Digest()
	if err != nil {
		return out, err
	}
	old, err := snapshot(ctx, q, p.PublisherID, p.ReleaseID)
	if err == nil && old.Digest != out.SnapshotDigest {
		return out, Conflict("同一 release 内容不同")
	}
	var f *Fault
	if err != nil && (!errors.As(err, &f) || f.Status != 404) {
		return out, err
	}
	previous := map[string]Entry{}
	if current.SourceReleaseID != nil {
		prior, err := snapshot(ctx, q, p.PublisherID, *current.SourceReleaseID)
		if err != nil {
			return out, err
		}
		for _, e := range prior.Entries {
			previous[e.Kind+"\x00"+e.ID] = e
		}
	}
	for _, e := range p.Entries {
		out.Counts[e.Kind]++
		key := e.Kind + "\x00" + e.ID
		action := "create"
		if prior, ok := previous[key]; ok {
			action = "update"
			if prior.ContentDigest == e.ContentDigest {
				action = "skip"
			}
		}
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(e.Metadata, &fields)
		name := stringValue(fields["name"])
		if name == "" {
			name = e.ID
		}
		out.Changes = append(out.Changes, Change{e.Kind, e.ID, name, action})
		delete(previous, key)
	}
	for _, e := range previous {
		out.Changes = append(out.Changes, Change{e.Kind, e.ID, e.ID, "remove"})
	}
	slices.SortFunc(out.Changes, func(a, b Change) int { return strings.Compare(a.Kind+"\x00"+a.ID, b.Kind+"\x00"+b.ID) })
	out.PlanDigest, err = canonicalHash(out)
	return out, err
}
func (s *Service) Apply(ctx context.Context, tx pgx.Tx, p *Package, actor, expected string) (Plan, error) {
	q := sqlc.New(tx)
	if _, err := q.LockCurrent(ctx); err != nil {
		return Plan{}, err
	}
	plan, err := s.plan(ctx, q, p)
	if err != nil {
		return plan, err
	}
	if plan.PlanDigest != expected {
		return plan, Conflict("设计当前修订已变化，请重新预览")
	}
	old, err := snapshot(ctx, q, p.PublisherID, p.ReleaseID)
	id := ""
	if err == nil {
		id = old.ID
	} else {
		var f *Fault
		if !errors.As(err, &f) || f.Status != 404 {
			return plan, err
		}
		id = uuid.New().String()
		if err = q.InsertSnapshot(ctx, payload(map[string]any{"id": id, "publisher_id": p.PublisherID, "release_id": p.ReleaseID, "schema_version": p.SchemaVersion, "digest_schema": p.DigestSchema, "snapshot_digest": plan.SnapshotDigest, "taxonomy": p.Taxonomy, "actor_user_id": actor})); err != nil {
			return plan, err
		}
		for _, entry := range p.Entries {
			var fields map[string]json.RawMessage
			_ = json.Unmarshal(entry.Metadata, &fields)
			if (entry.Kind == "design-system" || entry.Kind == "template" && boolValue(fields["downloadable"])) && entry.Native == nil {
				return plan, fmt.Errorf("资源 ZIP 尚未持久化: %s", entry.ID)
			}
			entryID := uuid.New().String()
			if err = q.InsertEntry(ctx, payload(map[string]any{"id": entryID, "snapshot_id": id, "entry": entry})); err != nil {
				return plan, err
			}
			for _, ref := range entry.Files {
				if err = q.InsertFile(ctx, payload(map[string]any{"entry_id": entryID, "path": ref.Path, "sha256": ref.SHA256, "size": ref.Size, "mime": ref.MIME, "role": ref.Role, "object_key": ObjectKey(ref.SHA256)})); err != nil {
					return plan, err
				}
			}
		}
	}
	changed, err := q.Activate(ctx, sqlc.ActivateParams{PublisherID: new(p.PublisherID), Column2: id, Revision: plan.CurrentRevision})
	if err != nil {
		return plan, err
	}
	if changed != 1 {
		return plan, Conflict("设计当前修订已变化")
	}
	return plan, nil
}
