package stats

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type reportingFilter struct {
	from, until                                                                                    time.Time
	limit                                                                                          int
	cursor                                                                                         string
	fingerprint                                                                                    string
	groupID, userID, modelID, expertID, clientType, platform, resourceID, resourceVersion, outcome string
	placeholders, purged                                                                           bool
}

func parseReportingFilter(r *http.Request, now time.Time) (reportingFilter, error) {
	q := r.URL.Query()
	f := reportingFilter{from: now.Add(-24 * time.Hour), until: now, limit: 50}
	for _, key := range []string{"from", "until"} {
		if !q.Has(key) {
			continue
		}
		at, err := time.Parse(time.RFC3339, q.Get(key))
		if err != nil {
			return f, resource.Invalid(key + " 需使用 RFC3339 时间")
		}
		if key == "from" {
			f.from = at
		} else {
			f.until = at
		}
	}
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return f, resource.Invalid("limit 必须为 1 至 100")
		}
		f.limit = n
	}
	if q.Has("page") || q.Has("page_size") {
		return f, resource.Invalid("会话上报接口仅支持 cursor 分页，不支持 page")
	}
	for _, item := range []struct {
		name   string
		target *string
	}{
		{"group_id", &f.groupID}, {"user_id", &f.userID}, {"model_id", &f.modelID}, {"expert_id", &f.expertID},
	} {
		*item.target = q.Get(item.name)
		if *item.target != "" {
			var id pgtype.UUID
			if err := id.Scan(*item.target); err != nil || !id.Valid {
				return f, resource.Invalid(item.name + " 无效")
			}
		}
	}
	for _, item := range []struct {
		name   string
		target *string
	}{
		{"client_type", &f.clientType}, {"platform", &f.platform}, {"resource_id", &f.resourceID},
		{"resource_version", &f.resourceVersion}, {"outcome", &f.outcome},
	} {
		*item.target = q.Get(item.name)
		if len(*item.target) > 256 {
			return f, resource.Invalid(item.name + " 过长")
		}
	}
	if f.clientType != "" && !oneOf(f.clientType, "desktop", "web", "extension", "mobile", "unknown") {
		return f, resource.Invalid("client_type 无效")
	}
	if f.platform != "" && !oneOf(f.platform, "macos", "windows", "linux", "ios", "android", "web") {
		return f, resource.Invalid("platform 无效")
	}
	if f.outcome != "" && !oneOf(f.outcome, "complete", "interrupted", "error", "max_turns", "output_limit", "unknown") {
		return f, resource.Invalid("outcome 无效")
	}
	for _, item := range []struct {
		name   string
		target *bool
	}{{"include_placeholders", &f.placeholders}, {"include_purged", &f.purged}} {
		if q.Has(item.name) {
			value, err := strconv.ParseBool(q.Get(item.name))
			if err != nil {
				return f, resource.Invalid(item.name + " 无效")
			}
			*item.target = value
		}
	}
	f.cursor = q.Get("cursor")
	if len(f.cursor) > 2048 {
		return f, resource.Invalid("cursor 无效")
	}
	if f.cursor != "" {
		var c reportCursor
		raw, err := base64.RawURLEncoding.DecodeString(f.cursor)
		if err != nil || json.Unmarshal(raw, &c) != nil {
			return f, resource.Invalid("cursor 无效")
		}
		if !q.Has("from") {
			f.from, err = time.Parse(time.RFC3339Nano, c.From)
			if err != nil {
				return f, resource.Invalid("cursor 时间无效")
			}
		}
		if !q.Has("until") {
			f.until, err = time.Parse(time.RFC3339Nano, c.Until)
			if err != nil {
				return f, resource.Invalid("cursor 时间无效")
			}
		}
		if !f.from.Before(f.until) {
			return f, resource.Invalid("cursor 时间无效")
		}
	}
	if !f.from.Before(f.until) {
		return f, resource.Invalid("结束时间必须晚于开始时间")
	}
	copyQuery := url.Values{}
	for key, values := range q {
		if key != "cursor" && key != "limit" {
			copyQuery[key] = values
		}
	}
	copyQuery.Set("from", f.from.Format(time.RFC3339Nano))
	copyQuery.Set("until", f.until.Format(time.RFC3339Nano))
	hash := sha256.Sum256([]byte(r.URL.Path + "?" + copyQuery.Encode()))
	f.fingerprint = hex.EncodeToString(hash[:])
	return f, nil
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func optional(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (f reportingFilter) sqlParams(c reportCursor, sessionID string) []byte {
	values := map[string]any{
		"from": f.from, "until": f.until, "limit": f.limit,
		"group_id": optional(f.groupID), "user_id": optional(f.userID),
		"model_id": optional(f.modelID), "expert_id": optional(f.expertID),
		"client_type": optional(f.clientType), "platform": optional(f.platform),
		"resource_id": optional(f.resourceID), "resource_version": optional(f.resourceVersion),
		"outcome": optional(f.outcome), "include_placeholders": f.placeholders,
		"include_purged": f.purged, "cursor_at": optional(c.At),
		"cursor_id": optional(c.ID), "cursor_key": optional(c.Key), "session_id": optional(sessionID),
	}
	data, _ := json.Marshal(values)
	return data
}

type reportCursor struct{ Fingerprint, From, Until, At, ID, Key string }

func (f reportingFilter) decodeCursor() (reportCursor, error) {
	if f.cursor == "" {
		return reportCursor{}, nil
	}
	var c reportCursor
	raw, err := base64.RawURLEncoding.DecodeString(f.cursor)
	if err != nil || json.Unmarshal(raw, &c) != nil || c.Fingerprint != f.fingerprint || c.From != f.from.Format(time.RFC3339Nano) || c.Until != f.until.Format(time.RFC3339Nano) {
		return c, resource.Invalid("cursor 无效或筛选条件已变化")
	}
	return c, nil
}
func (f reportingFilter) encodeCursor(c reportCursor) string {
	c.Fingerprint = f.fingerprint
	c.From, c.Until = f.from.Format(time.RFC3339Nano), f.until.Format(time.RFC3339Nano)
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func (s *Service) reportingRead(allowPurged bool, query func(context.Context, pgx.Tx, reportingFilter) (resource.Object, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		f, err := parseReportingFilter(r, s.now().UTC())
		if err == nil && f.purged {
			if !allowPurged {
				err = resource.Invalid("此接口不支持 include_purged")
			} else if !s.canReadPurged(r) {
				err = &resource.Error{Status: http.StatusForbidden, Code: "audit_permission_required", Message: "需要会话清除审计权限"}
			}
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			resource.Fail(w, err)
			return
		}
		defer rollbackStats(ctx, tx, "session-reporting")
		out, err := query(ctx, tx, f)
		if errors.Is(err, pgx.ErrNoRows) {
			err = resource.NotFound
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if out["tombstone"] != true {
			out["generated_at"], out["from"], out["until"] = s.now().UTC(), f.from, f.until
			if _, ok := out["data_freshness_seconds"]; !ok {
				out["data_freshness_seconds"] = nil
			}
		}
		resource.JSON(w, http.StatusOK, out)
	}
}

func unexpectedCursor() error {
	return resource.Invalid("此接口不支持 cursor；仅会话列表支持游标分页")
}
func purgedSession() error {
	return &resource.Error{Status: http.StatusGone, Code: "session_purged", Message: "会话统计数据已清除"}
}
