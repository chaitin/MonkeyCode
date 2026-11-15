package enginehost

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type upgradeResult struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
}

type upgradeTask struct {
	ID           string `json:"id"`
	Version      string `json:"version"`
	InstallerSHA string `json:"installer_sha256"`
	ManifestSHA  string `json:"manifest_sha256"`
}

func validUpgradeResult(v *upgradeResult) bool {
	if v == nil {
		return true
	}
	return idPattern.MatchString(v.ID) && versionPattern.MatchString(v.Version) && v.Version != "latest" &&
		(v.Status == "running" || v.Status == "succeeded" || v.Status == "failed") &&
		(v.Reason == "" || v.Reason == "upgrade_failed" || v.Reason == "launch_failed" || v.Reason == "upgrade_interrupted")
}

var numberedRelease = regexp.MustCompile(`^v[0-9]{8}$`)

func versionState(current, target string) string {
	if current != "" && current == target {
		return "current"
	}
	for _, version := range []string{current, target} {
		if !numberedRelease.MatchString(version) {
			return "unknown"
		}
		if _, err := time.Parse("20060102", "20"+version[1:7]); err != nil {
			return "unknown"
		}
	}
	if current < target {
		return "available"
	}
	return "ahead"
}

func upgradeJob(job sqlc.GetUpgradeRow) map[string]any {
	return map[string]any{"id": job.ID, "from_version": job.FromVersion, "version": job.Version, "status": job.Status, "reason": job.Reason, "created_at": job.CreatedAt, "updated_at": job.UpdatedAt}
}

func (s *Service) requestUpgrade(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in struct {
		Version string `json:"version"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !idPattern.MatchString(id) {
		fail(w, r, 404, "宿主不存在")
		return
	}
	if in.Version != s.version {
		fail(w, r, 409, "服务器目标版本已变化，请刷新后重试")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	defer tx.Rollback(context.Background())
	q := sqlc.New(tx)
	if err = q.LockControl(r.Context()); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	host, err := q.UpgradeHost(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, r, 404, "宿主不存在")
		return
	}
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	var report struct {
		UpgradeProtocol int `json:"upgrade_protocol"`
	}
	_ = json.Unmarshal(host.Report, &report)
	if host.Status != "active" || host.LastSeenAt == nil || time.Since(*host.LastSeenAt) > 90*time.Second {
		fail(w, r, 409, "宿主未在线，无法下发升级")
		return
	}
	if report.UpgradeProtocol != 1 {
		fail(w, r, 409, "当前 engine 不支持远程升级，请先使用统一安装脚本升级一次")
		return
	}
	if err = q.ExpireUpgrade(r.Context(), id); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	previous, err := q.GetUpgrade(r.Context(), id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(r.Context(), w, err)
		return
	}
	if err == nil && (previous.Status == "pending" || previous.Status == "running") {
		if previous.Version != in.Version {
			fail(w, r, 409, "宿主已有其他版本升级任务")
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, 202, upgradeJob(previous))
		return
	}
	if versionState(host.Version, s.version) != "available" {
		fail(w, r, 409, "目标版本必须高于当前版本；测试版本或无法比较的版本请使用统一安装脚本")
		return
	}
	m, raw, err := s.manifest(s.version, host.Architecture)
	if err != nil || !hasInstaller(m.Files) {
		fail(w, r, 503, "服务器升级资源不完整")
		return
	}
	job, err := q.SetUpgrade(r.Context(), sqlc.SetUpgradeParams{HostID: id, ID: resource.ID(), Version: s.version, InstallerSha256: m.Files["installer"], ManifestSha256: hash(raw)})
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 202, upgradeJob(sqlc.GetUpgradeRow(job)))
}

func (s *Service) heartbeatUpgrade(ctx context.Context, id, version string, result *upgradeResult, protocol int) (*upgradeTask, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	q := sqlc.New(tx)
	host, err := q.UpgradeHost(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && host.Status != "active") {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := q.ExpireUpgrade(ctx, id); err != nil {
		return nil, err
	}
	job, err := q.GetUpgrade(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if job.Status != "pending" && job.Status != "running" {
		return nil, tx.Commit(ctx)
	}
	if result != nil && result.ID == job.ID && result.Version == job.Version && (result.Status != "succeeded" || version == job.Version) {
		if err = q.ReportUpgrade(ctx, sqlc.ReportUpgradeParams{HostID: id, ID: job.ID, Status: result.Status, Reason: result.Reason}); err != nil {
			return nil, err
		}
		if result.Status != "running" {
			return nil, tx.Commit(ctx)
		}
	}
	if protocol != 1 {
		return nil, tx.Commit(ctx)
	}
	return &upgradeTask{job.ID, job.Version, job.InstallerSha256, job.ManifestSha256}, tx.Commit(ctx)
}

func (s *Service) upgradeView(ctx context.Context, id, current string, report []byte, online bool) (map[string]any, error) {
	var capabilities struct {
		Protocol int `json:"upgrade_protocol"`
	}
	_ = json.Unmarshal(report, &capabilities)
	q := sqlc.New(s.pool)
	if err := q.ExpireUpgrade(ctx, id); err != nil {
		return nil, err
	}
	job, err := q.GetUpgrade(ctx, id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var task any
	busy := false
	if err == nil {
		task = upgradeJob(job)
		busy = job.Status == "pending" || job.Status == "running"
	}
	comparison := versionState(current, s.version)
	return map[string]any{"target_version": s.version, "version_state": comparison, "update_available": comparison == "available",
		"supported": capabilities.Protocol == 1, "can_upgrade": online && capabilities.Protocol == 1 && comparison == "available" && !busy, "task": task}, nil
}
