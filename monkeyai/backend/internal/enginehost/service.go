package enginehost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool                      *pgxpool.Pool
	commands                  Commands
	server, releases, version string
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }
func (s *Service) WithInstallation(server, dir, version string) *Service {
	s.server, s.releases, s.version = strings.TrimRight(server, "/"), dir, version
	return s
}
func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/engine-hosts", s.list)
	r.Get("/engine-upgrade", s.upgradeCommand)
	r.Post("/engine-hosts/{id}/upgrade", s.requestUpgrade)
	r.Post("/engine-host-enrollments", s.create)
	r.Post("/engine-hosts/{id}/enrollment", s.renew)
	r.Delete("/engine-hosts/{id}", s.revoke)
	r.Delete("/engine-hosts/{id}/record", s.remove)
}
func (s *Service) Register(r chi.Router) {
	r.Route("/api/host/v1", func(r chi.Router) {
		r.Use(middleware.Throttle(32))
		r.Get("/install.sh", s.script)
		r.Get("/upgrade.sh", s.upgradeScript)
		r.Get("/releases/{version}/{arch}/{file}", s.artifact)
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(10 * time.Second))
			r.Post("/enroll", s.enroll)
			r.Post("/challenges", s.challenge)
			r.Post("/heartbeat", s.heartbeat)
			r.Post("/exchange", s.exchange)
		})
	})
}

var versionPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var idPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var pathPattern = regexp.MustCompile(`^/[a-zA-Z0-9/_-]+$`)

func token() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func hash(b []byte) string  { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func quote(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\"'\"'") + "'" }
func fail(w http.ResponseWriter, r *http.Request, status int, msg string) {
	resource.JSON(r.Context(), w, status, map[string]any{"error": map[string]string{"message": web.Message(r.Context(), "", msg)}})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, r, 400, "请求格式无效")
		return false
	}
	return true
}
func secureServer(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && !strings.ContainsAny(value, "\r\n\x00")
}
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	s.enrollment(w, r, false)
}

func (s *Service) renew(w http.ResponseWriter, r *http.Request) {
	if !idPattern.MatchString(chi.URLParam(r, "id")) {
		fail(w, r, 404, "宿主不存在")
		return
	}
	s.enrollment(w, r, true)
}

func (s *Service) enrollment(w http.ResponseWriter, r *http.Request, renew bool) {
	var in struct{}
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	if !secureServer(s.server) {
		fail(w, r, 503, "请先配置宿主可访问的 HTTPS 服务地址")
		return
	}
	for _, arch := range []string{"amd64", "arm64"} {
		if _, _, err := s.manifest(s.version, arch); err != nil {
			fail(w, r, 503, "服务器缺少完整的 engine 安装资源，请安装包含双架构 engine 的 server 安装包")
			return
		}
	}
	secret := token()
	q := sqlc.New(s.pool)
	var id string
	var expires time.Time
	var err error
	status := http.StatusCreated
	if renew {
		var row sqlc.RenewEnrollmentRow
		row, err = q.RenewEnrollment(r.Context(), sqlc.RenewEnrollmentParams{ID: chi.URLParam(r, "id"), EnrollmentHash: hash([]byte(secret)), Version: s.version})
		id, expires, status = row.ID, row.EnrollmentExpiresAt, http.StatusOK
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, r, 409, "宿主已接入、撤销或删除，请刷新列表")
			return
		}
	} else {
		var row sqlc.CreateEnrollmentRow
		row, err = q.CreateEnrollment(r.Context(), sqlc.CreateEnrollmentParams{Name: "待接入宿主", Architecture: "amd64", Version: s.version, EnrollmentHash: hash([]byte(secret))})
		id, expires = row.ID, row.EnrollmentExpiresAt
	}
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	address := s.server + "/api/host/v1/install.sh?token=" + url.QueryEscape(secret)
	command := `sudo bash -c "$(curl -kfsSL ` + quote(address) + ` || echo 'exit 1')"`
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, status, map[string]any{"host_id": id, "expires_at": expires, "command": command, "version": s.version})
}
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	page, size, err := resource.PageParamsWithLimit(r, 100)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	q := sqlc.New(s.pool)
	rows, err := q.ListHosts(r.Context(), sqlc.ListHostsParams{Limit: int32(size), Offset: int32((page - 1) * size)})
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	items := []map[string]any{}
	for _, row := range rows {
		online := row.Status == "active" && row.LastSeenAt != nil && time.Since(*row.LastSeenAt) < 90*time.Second
		upgrade, err := s.upgradeView(r.Context(), row.ID, row.Version, row.Report, online)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		items = append(items, map[string]any{"scheduling_enabled": row.SchedulingEnabled, "upgrade": upgrade, "id": row.ID, "name": row.Name, "architecture": row.Architecture, "version": row.Version, "status": row.Status, "online": online, "enrollment_expires_at": row.EnrollmentExpiresAt, "enrolled_at": row.EnrolledAt, "last_seen_at": row.LastSeenAt, "report": json.RawMessage(row.Report), "created_at": row.CreatedAt})
	}
	total, err := q.CountHosts(r.Context())
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]any{"items": items, "total": total, "page": page, "page_size": size})
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !idPattern.MatchString(id) {
		fail(w, r, 404, "宿主不存在")
		return
	}
	result, err := sqlc.New(s.pool).RevokeHost(r.Context(), id)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if result == 0 {
		fail(w, r, 404, "宿主不存在")
		return
	}
	w.WriteHeader(204)
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !idPattern.MatchString(id) {
		fail(w, r, 404, "宿主不存在")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	defer tx.Rollback(context.WithoutCancel(r.Context()))
	q := sqlc.New(tx)
	// 与环境创建、状态更新使用相同的锁，避免检查后又分配新环境。
	if _, err := q.LockControl(r.Context()); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	exists, err := q.HostExists(r.Context(), id)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if !exists {
		w.WriteHeader(204)
		return
	}
	n, err := q.DeleteHost(r.Context(), id)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if n == 0 {
		fail(w, r, 409, "宿主仍有关联云环境，请先删除环境并等待清理完成")
		return
	}
	if err := q.DisableHost(r.Context(), id); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Service) enroll(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token        string `json:"token"`
		Name         string `json:"name"`
		PublicKey    []byte `json:"public_key"`
		Signature    []byte `json:"signature"`
		Architecture string `json:"architecture"`
		Version      string `json:"version"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Name) > 128 || strings.ContainsAny(in.Name, "\r\n\x00") || (in.Architecture != "amd64" && in.Architecture != "arm64") {
		fail(w, r, 400, "宿主名称或架构无效")
		return
	}
	message := []byte("monkeyai-engine/enroll/v1\n" + s.server + "\n" + in.Token + "\n" + in.Architecture + "\n" + in.Version)
	if in.Name != "" {
		message = append(message, []byte("\n"+in.Name)...)
	}
	if len(in.Token) != 43 || len(in.PublicKey) != ed25519.PublicKeySize || !ed25519.Verify(in.PublicKey, message, in.Signature) {
		fail(w, r, 401, "接入凭据或签名无效")
		return
	}
	// 行锁保证令牌只能绑定一个公钥；同一公钥可在有效期内重试丢失的响应。
	id, err := sqlc.New(s.pool).EnrollHost(r.Context(), sqlc.EnrollHostParams{Name: in.Name, EnrollmentHash: hash([]byte(in.Token)), PublicKey: in.PublicKey, Architecture: in.Architecture, Version: in.Version})
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, r, 401, "接入命令已过期、撤销或被其他宿主使用")
		return
	}
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]string{"host_id": id})
}
func (s *Service) challenge(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HostID string `json:"host_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !idPattern.MatchString(in.HostID) {
		fail(w, r, 401, "宿主不可用")
		return
	}
	// 每宿主只保留一个短期挑战，重复请求复用，避免无界存储与抢占有效挑战。
	challenge, err := sqlc.New(s.pool).HostChallenge(r.Context(), sqlc.HostChallengeParams{ID: in.HostID, Challenge: token()})
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, r, 401, "宿主不可用")
		return
	}
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]string{"challenge": challenge})
}
func (s *Service) heartbeat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HostID    string          `json:"host_id"`
		Challenge string          `json:"challenge"`
		Report    json.RawMessage `json:"report"`
		Signature []byte          `json:"signature"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !idPattern.MatchString(in.HostID) || len(in.Challenge) != 43 || len(in.Report) > 32<<10 || !json.Valid(in.Report) {
		fail(w, r, 400, "宿主报告无效")
		return
	}
	var report struct {
		System          *systemReport  `json:"system"`
		NetworkPolicies []string       `json:"network_policies"`
		Version         int            `json:"version"`
		EngineVersion   string         `json:"engine_version"`
		Prerequisites   bool           `json:"prerequisites_met"`
		UpgradeProtocol int            `json:"upgrade_protocol"`
		Upgrade         *upgradeResult `json:"upgrade,omitempty"`
		RuntimeProtocol int            `json:"runtime_protocol"`
		Workload        bool           `json:"workload_verified"`
		Checks          []struct {
			Name   string `json:"name"`
			Passed bool   `json:"passed"`
			Detail string `json:"detail"`
		} `json:"checks"`
	}
	if json.Unmarshal(in.Report, &report) != nil || !validSystem(report.System) || (report.EngineVersion != "" && (!versionPattern.MatchString(report.EngineVersion) || report.EngineVersion == "latest")) || report.Version != 1 || report.UpgradeProtocol < 0 || report.UpgradeProtocol > 1 || !validUpgradeResult(report.Upgrade) || report.RuntimeProtocol < 0 || report.RuntimeProtocol > 1 || report.Workload || len(report.Checks) > 100 || !validNetworkPolicies(report.NetworkPolicies) {
		fail(w, r, 400, "宿主报告版本、检查项或执行能力声明无效")
		return
	}
	public, err := sqlc.New(s.pool).HostKey(r.Context(), in.HostID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, r, 401, "宿主不可用")
		} else {
			resource.Fail(r.Context(), w, err)
		}
		return
	}
	message := []byte("monkeyai-engine/heartbeat/v1\n" + s.server + "\n" + in.HostID + "\n" + in.Challenge + "\n" + hash(in.Report))
	if len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, message, in.Signature) {
		fail(w, r, 401, "宿主签名无效")
		return
	}
	result, err := sqlc.New(s.pool).RecordHeartbeat(r.Context(), sqlc.RecordHeartbeatParams{ID: in.HostID, Challenge: in.Challenge, Report: networkReport(in.Report, r)})
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if result != 1 {
		fail(w, r, 401, "挑战已消费或过期")
		return
	}
	upgrade, err := s.heartbeatUpgrade(r.Context(), in.HostID, report.EngineVersion, report.Upgrade, report.UpgradeProtocol)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 200, map[string]any{"accepted": true, "workload_enabled": false, "upgrade": upgrade})
}

func validNetworkPolicies(policies []string) bool {
	if len(policies) > 2 {
		return false
	}
	for i, p := range policies {
		if (p != "isolated" && p != "public-only") || slices.Contains(policies[:i], p) {
			return false
		}
	}
	return true
}
