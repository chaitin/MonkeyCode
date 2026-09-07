package billing

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

const entryFilter = ` WHERE ($1='' OR COALESCE(e.user_name,'') ILIKE '%'||$1||'%' OR COALESCE(e.user_email,'') ILIKE '%'||$1||'%') AND ($2='' OR e.item_name ILIKE '%'||$2||'%') AND ($3='' OR e.category=$3) AND ($4='' OR e.mode=$4) AND ($5='' OR e.entry_type=$5) AND ($6::timestamptz IS NULL OR e.occurred_at >= $6) AND ($7::timestamptz IS NULL OR e.occurred_at < $7) AND ($8='' OR e.group_id=NULLIF($8,'')::uuid)`

func filters(r *http.Request) ([]any, error) {
	q := r.URL.Query()
	var from, until *time.Time
	for key, target := range map[string]**time.Time{"from": &from, "until": &until} {
		if v := q.Get(key); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return nil, resource.Invalid("筛选时间需使用带时区的 ISO 格式")
			}
			*target = &t
		}
	}
	if from != nil && until != nil && !from.Before(*until) {
		return nil, resource.Invalid("结束时间必须晚于开始时间")
	}
	for _, key := range []string{"user", "content"} {
		if len(q.Get(key)) > 200 {
			return nil, resource.Invalid("搜索条件过长")
		}
	}
	return []any{q.Get("user"), q.Get("content"), q.Get("category"), q.Get("mode"), q.Get("entry_type"), from, until, q.Get("group_id")}, nil
}
func (s *Service) entries(w http.ResponseWriter, r *http.Request) {
	args, err := filters(r)
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
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM credit_ledger_entries e`+entryFilter, args...).Scan(&total); err != nil {
		resource.Fail(w, err)
		return
	}
	args = append(args, size, (page-1)*size)
	rows, err := resource.Rows(r.Context(), tx, `SELECT to_jsonb(e)||jsonb_build_object('credit_delta',e.credit_delta::text,'balance_after',e.balance_after::text,'unit_credits',e.unit_credits::text,'sequence',e.sequence::text) FROM credit_ledger_entries e`+entryFilter+` ORDER BY e.occurred_at DESC,e.id DESC LIMIT $9 OFFSET $10`, args...)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, map[string]any{"items": rows, "total": total, "page": page, "page_size": size})
}
func (s *Service) summary(w http.ResponseWriter, r *http.Request) {
	args, err := filters(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := resource.Row(r.Context(), s.pool, `SELECT jsonb_build_object('charges',COALESCE(-sum(credit_delta) FILTER(WHERE entry_type='charge'),0)::text,'refunds',COALESCE(sum(credit_delta) FILTER(WHERE entry_type='refund'),0)::text,'net_consumption',COALESCE(-sum(credit_delta) FILTER(WHERE entry_type IN ('charge','refund')),0)::text,'count',count(*)) FROM credit_ledger_entries e`+entryFilter, args...)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, out)
}
func (s *Service) transaction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	out, err := resource.Row(r.Context(), s.pool, `SELECT to_jsonb(t)||jsonb_build_object('reserve',reserve::text,'amount',amount::text,'raw_amount',raw_amount::text) FROM billing_transactions t WHERE id=$1`, id)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	entries, err := resource.Rows(r.Context(), s.pool, `SELECT to_jsonb(e)||jsonb_build_object('credit_delta',credit_delta::text,'balance_after',balance_after::text) FROM credit_ledger_entries e WHERE transaction_id=$1 ORDER BY sequence`, id)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out["entries"] = entries
	wallets, err := resource.Rows(r.Context(), s.pool, `SELECT jsonb_build_object('biz_id',biz_id,'status',status,'external_user_id',external_user_id,'environment',environment,'app_id',app_id,'frozen_amount_quota',frozen_amount_quota::text,'actual_amount_quota',actual_amount_quota::text,'error_code',error_code,'trace_id',trace_id,'confirmed_at',confirmed_at) FROM wallet_billing_records WHERE transaction_id=$1`, id)
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
	rows, err := resource.Rows(ctx, s.pool, `SELECT jsonb_build_object('id',id,'user_id',user_id,'user_name',user_name,'user_email',user_email,'item_name',item_name,'category',category,'mode',mode,'status',status,'reserve',reserve::text,'amount',amount::text,'error_code',error_code,'attempts',attempts,'started_at',started_at) FROM billing_transactions WHERE status NOT IN ('settled','released','rejected') ORDER BY started_at,id LIMIT $1 OFFSET $2`, size, (page-1)*size)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	var total int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM billing_transactions WHERE status NOT IN ('settled','released','rejected')`).Scan(&total); err != nil {
		resource.Fail(w, err)
		return
	}
	differences, err := resource.Rows(ctx, s.pool, `SELECT jsonb_build_object('account_id',a.id,'user_id',a.user_id,'balance',a.balance::text,'ledger_balance',COALESCE(l.balance,0)::text,'frozen',a.frozen::text,'reserved',COALESCE(t.reserved,0)::text) FROM credit_accounts a LEFT JOIN LATERAL(SELECT sum(credit_delta) balance FROM credit_ledger_entries WHERE account_id=a.id) l ON true LEFT JOIN LATERAL(SELECT sum(reserve) reserved FROM billing_transactions WHERE account_id=a.id AND status NOT IN ('settled','released','rejected')) t ON true WHERE a.balance<>COALESCE(l.balance,0) OR a.frozen<>COALESCE(t.reserved,0) ORDER BY a.created_at LIMIT 100`)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	issues, err := resource.Rows(ctx, s.pool, `SELECT to_jsonb(i) FROM billing_migration_issues i ORDER BY id LIMIT 100`)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, map[string]any{"items": rows, "total": total, "page": page, "page_size": size, "differences": differences, "migration_issues": issues})
}
func (s *Service) retry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var state string
	if err := s.pool.QueryRow(r.Context(), `SELECT status FROM billing_transactions WHERE id=$1`, id).Scan(&state); err != nil {
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
	err = tx.QueryRow(r.Context(), `SELECT status,mode FROM billing_transactions WHERE id=$1 FOR UPDATE`, id).Scan(&state, &mode)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if state != "unknown" {
		resource.Fail(w, fail(409, "transaction_not_unknown", "只有结果未知的交易可以核查处理"))
		return
	}
	if mode == "remote" {
		var ws string
		if err = tx.QueryRow(r.Context(), `SELECT status FROM wallet_billing_records WHERE transaction_id=$1`, id).Scan(&ws); err != nil {
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
	if err = audit(r.Context(), tx, u.ID, "resolve_transaction", id, json.RawMessage(body)); err == nil {
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
