package billing

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
)

func filters(r *http.Request) (sqlc.CountEntriesParams, error) {
	q := r.URL.Query()
	var from, until *time.Time
	for key, target := range map[string]**time.Time{"from": &from, "until": &until} {
		if v := q.Get(key); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return sqlc.CountEntriesParams{}, resource.Invalid("筛选时间需使用带时区的 ISO 格式")
			}
			*target = &t
		}
	}
	if from != nil && until != nil && !from.Before(*until) {
		return sqlc.CountEntriesParams{}, resource.Invalid("结束时间必须晚于开始时间")
	}
	for _, key := range []string{"user", "content"} {
		if len(q.Get(key)) > 200 {
			return sqlc.CountEntriesParams{}, resource.Invalid("搜索条件过长")
		}
	}
	return sqlc.CountEntriesParams{
		UserQuery:    q.Get("user"),
		ContentQuery: q.Get("content"),
		Category:     q.Get("category"),
		Mode:         q.Get("mode"),
		EntryType:    q.Get("entry_type"),
		FromTime:     from,
		UntilTime:    until,
		GroupID:      q.Get("group_id"),
	}, nil
}
func (s *Service) entries(w http.ResponseWriter, r *http.Request) {
	filter, err := filters(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	page, size := pageParams(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var total int64
	total, err = sqlc.New(tx).CountEntries(r.Context(), filter)
	if err != nil {
		resource.Fail(w, err)
		return
	}

	rows, err := resource.DecodeObjects(sqlc.New(tx).ListEntries(r.Context(), sqlc.ListEntriesParams{
		UserQuery:    filter.UserQuery,
		ContentQuery: filter.ContentQuery,
		Category:     filter.Category,
		Mode:         filter.Mode,
		EntryType:    filter.EntryType,
		FromTime:     filter.FromTime,
		UntilTime:    filter.UntilTime,
		GroupID:      filter.GroupID,
		Limit:        int32(size),
		Offset:       int32((page - 1) * size),
	}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, map[string]any{"items": rows, "total": total, "page": page, "page_size": size})
}
func (s *Service) summary(w http.ResponseWriter, r *http.Request) {
	filter, err := filters(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := resource.DecodeObject(sqlc.New(s.pool).SummarizeEntries(r.Context(), sqlc.SummarizeEntriesParams(filter)))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, out)
}
func (s *Service) transaction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	out, err := resource.DecodeObject(sqlc.New(s.pool).GetTransaction(r.Context(), id))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	entries, err := resource.DecodeObjects(sqlc.New(s.pool).TransactionEntries(r.Context(), new(id)))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out["entries"] = entries
	wallets, err := resource.DecodeObjects(sqlc.New(s.pool).TransactionWalletRecords(r.Context(), id))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out["wallet_records"] = wallets
	resource.JSON(w, 200, out)
}
func (s *Service) reconciliation(w http.ResponseWriter, r *http.Request) {
	page, size := pageParams(r)
	ctx := r.Context()
	rows, err := resource.DecodeObjects(sqlc.New(s.pool).PendingTransactions(ctx, sqlc.PendingTransactionsParams{Limit: int32(size), Offset: int32((page - 1) * size)}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	var total int64
	total, err = sqlc.New(s.pool).CountPendingTransactions(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}

	differences, err := resource.DecodeObjects(sqlc.New(s.pool).AccountDifferences(ctx))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	issues, err := resource.DecodeObjects(sqlc.New(s.pool).MigrationIssues(ctx))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, map[string]any{"items": rows, "total": total, "page": page, "page_size": size, "differences": differences, "migration_issues": issues})
}
func (s *Service) retry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	state, err := sqlc.New(s.pool).TransactionStatus(r.Context(), id)
	if err != nil {
		resource.Fail(w, err)
		return
	}

	if state != "settling" {
		resource.Fail(w, fail(409, "transaction_not_retryable", "只有已确定用量的待结算交易可重试；未知结果需先核查"))
		return
	}
	u, _ := identity.UserFromContext(r.Context())
	if err := audit(r.Context(), s.pool, u.ID, "retry_settlement", id, map[string]string{"status": state}); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := s.Settle(r.Context(), id); err != nil {
		resource.Fail(w, err)
		return
	}
	s.transaction(w, r)
}
func (s *Service) resolve(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Usage  Usage  `json:"usage"`
		Reason string `json:"reason"`
	}
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	if strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 1000 {
		resource.Fail(w, resource.Invalid("核查需填写证据和处理原因"))
		return
	}
	id := chi.URLParam(r, "id")
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var state, mode string
	var record sqlc.LockTransactionStatusRow
	record, err = sqlc.New(tx).LockTransactionStatus(r.Context(), id)

	if err != nil {
		resource.Fail(w, err)
		return
	}
	state, mode = record.Status, record.Mode

	if state != "unknown" {
		resource.Fail(w, fail(409, "transaction_not_unknown", "只有结果未知的交易可以核查处理"))
		return
	}
	if mode == "remote" {
		var ws string
		ws, err = sqlc.New(tx).WalletStatus(r.Context(), id)
		if err != nil {
			resource.Fail(w, err)
			return
		}

		if ws != "reserved" {
			resource.Fail(w, fail(409, "wallet_review_required", "需先通过百智云核实预扣状态，不能仅在本地解除冻结"))
			return
		}
	}
	u, _ := identity.UserFromContext(r.Context())
	in.Usage.Known = true
	body, _ := json.Marshal(in)
	err = audit(r.Context(), tx, u.ID, "resolve_transaction", id, json.RawMessage(body))

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	if err = s.Finish(r.Context(), id, in.Usage); err != nil {
		resource.Fail(w, err)
		return
	}
	s.transaction(w, r)
}
