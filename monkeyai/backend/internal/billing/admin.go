package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/billing/settings", s.settings)
	r.Patch("/billing/settings/{section}", s.saveSettings)
	r.Get("/billing/quotas", s.quotas)
	r.Put("/billing/quotas", s.saveQuotas)
	r.Get("/billing/accounts/{userID}", s.account)
	r.Post("/billing/accounts/{userID}/adjustments", s.adjust)
	r.Put("/billing/accounts/{userID}/wallet", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ExternalID string `json:"external_user_id"`
		}
		if err := resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		u, _ := identity.UserFromContext(r.Context())
		if err := s.BindWallet(r.Context(), u.ID, chi.URLParam(r, "userID"), in.ExternalID); err != nil {
			resource.Fail(w, err)
			return
		}
		w.WriteHeader(204)
	})
	r.Get("/billing/entries", s.entries)
	r.Get("/billing/summary", s.summary)
	r.Get("/billing/transactions/{id}", s.transaction)
	r.Get("/billing/reconciliation", s.reconciliation)
	r.Post("/billing/transactions/{id}/retry", s.retry)
	r.Post("/billing/transactions/{id}/resolve", s.resolve)
	r.Post("/billing/transactions/{id}/refund", s.refund)
}
func (s *Service) RegisterAgent(r chi.Router) {
	r.Get("/billing/account", func(w http.ResponseWriter, r *http.Request) {
		u, _ := identity.UserFromContext(r.Context())
		a, err := s.Account(r.Context(), u.ID)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, 200, a)
	})
}
func (s *Service) settings(w http.ResponseWriter, r *http.Request) {
	p, err := s.Policy(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	wallet, err := s.wallet(r.Context(), s.pool)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	_, end := p.period(s.now())
	resource.JSON(w, 200, map[string]any{"policy": p, "wallet": wallet.info(), "timezone": "Asia/Shanghai", "next_refresh_at": end})
}
func (s *Service) saveSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]json.RawMessage
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	section := chi.URLParam(r, "section")
	allowed := []string{"revision"}
	switch section {
	case "pricing":
		allowed = append(allowed, "input_credits_per_million_tokens", "cached_input_credits_per_million_tokens", "output_credits_per_million_tokens")
	case "cycle":
		allowed = append(allowed, "quota_refresh_cycle")
	case "mode":
		allowed = append(allowed, "charging_mode", "enabled")
	case "wallet":
		allowed = append(allowed, "environment", "app_id", "certificate", "private_key", "ca_certificate")
	default:
		resource.Fail(w, resource.NotFound)
		return
	}
	for k := range in {
		if !slices.Contains(allowed, k) {
			resource.Fail(w, resource.Invalid("配置块包含未知字段"))
			return
		}
	}
	var revision int64
	if json.Unmarshal(in["revision"], &revision) != nil {
		resource.Fail(w, resource.Invalid("缺少配置修订号"))
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	p, err := s.policy(r.Context(), tx, true)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if p.Revision != revision {
		resource.Fail(w, conflict)
		return
	}
	before := p
	var walletBefore, walletAfter WalletInfo
	switch section {
	case "pricing":
		for key, target := range map[string]*Amount{"input_credits_per_million_tokens": &p.Input, "cached_input_credits_per_million_tokens": &p.Cached, "output_credits_per_million_tokens": &p.Output} {
			if err = json.Unmarshal(in[key], target); err != nil || *target < 0 || *target > Amount(1_000_000*scale) {
				resource.Fail(w, resource.Invalid("单价须为 0 到 1000000 的积分值，最多六位小数"))
				return
			}
		}
	case "cycle":
		var cycle string
		if json.Unmarshal(in["quota_refresh_cycle"], &cycle) != nil || !slices.Contains([]string{"daily", "weekly", "monthly"}, cycle) {
			resource.Fail(w, resource.Invalid("刷新周期无效"))
			return
		}
		_, end := p.period(s.now())
		if p.CycleEffectiveAt != nil && !s.now().Before(*p.CycleEffectiveAt) {
			p.Cycle = p.PendingCycle
			p.CycleAnchor = p.CycleEffectiveAt
			p.PendingCycle = ""
			p.CycleEffectiveAt = nil
		}
		if cycle != p.Cycle {
			p.PendingCycle = cycle
			p.CycleEffectiveAt = &end
		} else {
			p.PendingCycle = ""
			p.CycleEffectiveAt = nil
		}
	case "mode":
		if json.Unmarshal(in["charging_mode"], &p.Mode) != nil || !slices.Contains([]string{"local", "remote"}, p.Mode) || json.Unmarshal(in["enabled"], &p.Enabled) != nil {
			resource.Fail(w, resource.Invalid("计费方式或启用状态无效"))
			return
		}
		if p.Mode == "remote" {
			wallet, e := s.wallet(r.Context(), tx)
			if e != nil {
				resource.Fail(w, e)
				return
			}
			if !wallet.ready() {
				resource.Fail(w, fail(422, "wallet_not_configured", "请先在计费设置中配置有效的百智云应用和证书"))
				return
			}
		}
	case "wallet":
		walletBefore, walletAfter, err = s.saveWallet(r.Context(), tx, in)
		if err != nil {
			resource.Fail(w, err)
			return
		}
	}
	p.Revision++
	raw, _ := json.Marshal(p)
	u, _ := identity.UserFromContext(r.Context())
	_, err = sqlc.New(tx).SavePolicy(r.Context(), sqlc.SavePolicyParams{Value: raw, Revision: int64(p.Revision), UpdatedByUserID: u.ID})
	if err == nil {
		data := map[string]any{"before": before, "after": p}
		if section == "wallet" {
			data = map[string]any{"before": walletBefore, "after": walletAfter}
		}
		err = audit(r.Context(), tx, u.ID, "configure_"+section, "", data)
	}

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	s.settings(w, r)
}
func (s *Service) quotas(w http.ResponseWriter, r *http.Request) {
	p, err := s.Policy(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}

	groups, err := resource.DecodeObjects(sqlc.New(s.pool).ListGroupQuotas(r.Context()))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	users, err := resource.DecodeObjects(sqlc.New(s.pool).ListUserQuotas(r.Context(), sqlc.ListUserQuotasParams{RootGroup: rootGroup, RootCredits: p.RootCredits.String()}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	var teamName string
	teamName, err = sqlc.New(s.pool).WorkspaceName(r.Context())

	if err != nil {
		resource.Fail(w, err)
		return
	}
	groups = append([]resource.Object{{"id": rootGroup, "parent_id": nil, "name": teamName, "credits": p.RootCredits.String()}}, groups...)
	_, end := p.period(s.now())
	resource.JSON(w, 200, map[string]any{"groups": groups, "users": users, "revision": p.Revision, "effective_at": end})
}
func (s *Service) saveQuotas(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Revision int64 `json:"revision"`
		Changes  []struct {
			Type    string          `json:"subject_type"`
			ID      string          `json:"id"`
			Credits json.RawMessage `json:"credits"`
		} `json:"changes"`
	}
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	if len(in.Changes) == 0 || len(in.Changes) > 1000 {
		resource.Fail(w, resource.Invalid("每次需提交 1 到 1000 项额度变更"))
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	p, err := s.policy(r.Context(), tx, true)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if p.Revision != in.Revision {
		resource.Fail(w, conflict)
		return
	}
	u, _ := identity.UserFromContext(r.Context())
	if err = s.PreserveAccounts(r.Context(), tx); err != nil {
		resource.Fail(w, err)
		return
	}
	seen := map[string]bool{}
	for _, v := range in.Changes {
		if !slices.Contains([]string{"group", "user"}, v.Type) || v.ID == "" || len(v.Credits) == 0 || seen[v.Type+v.ID] {
			resource.Fail(w, resource.Invalid("额度对象无效或重复"))
			return
		}
		seen[v.Type+v.ID] = true
		var amount *Amount
		if err = json.Unmarshal(v.Credits, &amount); err != nil || amount != nil && *amount < 0 {
			resource.Fail(w, resource.Invalid("额度需为非负积分或 null"))
			return
		}
		if v.Type == "group" && v.ID == rootGroup {
			if amount == nil {
				resource.Fail(w, resource.Invalid("团队必须设置额度"))
				return
			}
			before := p.RootCredits
			p.RootCredits = *amount
			if _, err = sqlc.New(tx).SetRootQuota(r.Context(), amount.String()); err != nil {
				resource.Fail(w, err)
				return
			}
			if err = audit(r.Context(), tx, u.ID, "configure_quota", "", map[string]any{"subject_type": "team", "before": before, "after": amount}); err != nil {
				resource.Fail(w, err)
				return
			}
			continue
		}
		var exists bool
		exists, err = sqlc.New(tx).SubjectExists(r.Context(), sqlc.SubjectExistsParams{ID: v.ID, SubjectType: v.Type})

		if err != nil || !exists {
			if err == nil {
				err = resource.NotFound
			}
			resource.Fail(w, err)
			return
		}
		var previous *string
		previousQuota, queryErr := sqlc.New(tx).GetQuota(r.Context(), sqlc.GetQuotaParams{GroupID: new(v.ID), SubjectType: v.Type})
		if queryErr == nil {
			previous = new(previousQuota)
		}

		_, err = sqlc.New(tx).DeleteQuota(r.Context(), sqlc.DeleteQuotaParams{GroupID: new(v.ID), SubjectType: v.Type})
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if amount != nil {
			_, err = sqlc.New(tx).CreateQuota(r.Context(), sqlc.CreateQuotaParams{SubjectType: v.Type, SubjectID: v.ID, CreditsPerCycle: amount.String(), UpdatedByUserID: u.ID})
			if err != nil {
				resource.Fail(w, err)
				return
			}
		}
		if err = audit(r.Context(), tx, u.ID, "configure_quota", v.ID, map[string]any{"subject_type": v.Type, "before": previous, "after": amount}); err != nil {
			resource.Fail(w, err)
			return
		}
	}
	_, err = sqlc.New(tx).TouchPolicy(r.Context(), u.ID)

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	s.quotas(w, r)
}
func (s *Service) account(w http.ResponseWriter, r *http.Request) {
	user := chi.URLParam(r, "userID")
	a, err := s.Account(r.Context(), user)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	history, err := resource.DecodeObjects(sqlc.New(s.pool).AccountHistory(r.Context(), user))
	if err != nil {
		resource.Fail(w, err)
		return
	}

	external, _ := sqlc.New(s.pool).WalletUser(r.Context(), user)

	wallet, err := s.wallet(r.Context(), s.pool)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out := map[string]any{"account": a, "history": history, "external_user_id": external, "wallet": wallet.info()}
	if external != "" && wallet.ready() {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		balance, e := wallet.Client.GetUserCreditBalance(ctx, external)
		if e == nil {
			out["wallet_available"] = Amount(balance.AvailableCreditCents * 10000)
			out["wallet_queried_at"] = s.now()
		} else {
			out["wallet_error"] = "百智云余额查询失败"
		}
	}
	resource.JSON(w, 200, out)
}
func (s *Service) adjust(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Delta   Amount `json:"delta"`
		Reason  string `json:"reason"`
		Version string `json:"version"`
	}
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Delta == 0 || in.Reason == "" || len(in.Reason) > 500 || in.Version == "" || len(in.Version) > 128 {
		resource.Fail(w, resource.Invalid("调整需填写非零积分、原因和账户版本"))
		return
	}
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	p, err := s.policy(ctx, tx, false)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	a, err := s.ensureAccount(ctx, tx, chi.URLParam(r, "userID"), p)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	event := "adjust:" + a.UserID + ":" + in.Version
	var oldAmount, oldReason string
	record, e := sqlc.New(tx).GetAdjustment(ctx, new(event))
	if e == nil {
		oldAmount, oldReason = record.CreditDelta, record.ItemName
	}

	if e == nil {
		if oldAmount != in.Delta.String() && amountText(oldAmount) != in.Delta || oldReason != in.Reason {
			resource.Fail(w, fail(409, "idempotency_conflict", "该账户版本已提交过不同的调整，请刷新后重试"))
			return
		}
		if err = tx.Commit(ctx); err != nil {
			resource.Fail(w, err)
			return
		}
		s.account(w, r)
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		resource.Fail(w, e)
		return
	}
	if in.Version != a.Version {
		resource.Fail(w, resource.Conflict)
		return
	}
	if in.Delta > 0 && a.Balance > maxAmount-in.Delta {
		resource.Fail(w, resource.Invalid("账户余额超出允许范围"))
		return
	}
	if in.Delta < 0 && a.Available < -in.Delta {
		resource.Fail(w, insufficient)
		return
	}
	_, err = sqlc.New(tx).AdjustBalance(ctx, sqlc.AdjustBalanceParams{ID: a.ID, Balance: in.Delta.String()})
	if err == nil {
		err = ledger(ctx, tx, a.ID, "", event, "adjustment", "other", in.Reason, in.Delta, "local", nil)
	}
	u, _ := identity.UserFromContext(ctx)
	if err == nil {
		err = audit(ctx, tx, u.ID, "adjust_credits", a.UserID, in)
	}

	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	s.account(w, r)
}
func pageParams(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		page = 100000
	}
	if size < 1 || size > 100 {
		size = 20
	}
	return page, size
}

func (s *Service) refund(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reason string `json:"reason"`
	}
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" || len(in.Reason) > 500 {
		resource.Fail(w, resource.Invalid("退款需填写原因"))
		return
	}
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var account, mode, status, amountText, category, item string
	var record sqlc.LockRefundRow
	record, err = sqlc.New(tx).LockRefund(ctx, id)

	if err != nil {
		resource.Fail(w, err)
		return
	}
	account, mode, status, amountText, category, item = record.AccountID, record.Mode, record.Status, record.Amount, record.Category, record.ItemName

	if mode != "local" {
		resource.Fail(w, fail(409, "wallet_refund_required", "远程退款需经百智云退款或对账渠道处理"))
		return
	}
	amount, err := ParseAmount(amountText)
	if err != nil || amount <= 0 || status != "settled" {
		resource.Fail(w, fail(409, "transaction_not_refundable", "仅已结算的非零本地扣款可退款"))
		return
	}
	var existing bool
	existing, err = sqlc.New(tx).EventExists(ctx, new("refund:"+id))
	if err != nil {
		resource.Fail(w, err)
		return
	}

	if existing {
		s.transaction(w, r)
		return
	}
	var charge string
	charge, err = sqlc.New(tx).EventID(ctx, new("charge:"+id))
	if err != nil {
		resource.Fail(w, err)
		return
	}

	var balance string
	balance, err = sqlc.New(tx).LockBalance(ctx, account)
	if err != nil {
		resource.Fail(w, err)
		return
	}

	current, err := ParseAmount(balance)
	if err != nil || current > maxAmount-amount {
		resource.Fail(w, resource.Invalid("退款后余额超出允许范围，请先处理账户额度"))
		return
	}
	_, err = sqlc.New(tx).AdjustBalance(ctx, sqlc.AdjustBalanceParams{ID: account, Balance: amount.String()})
	if err == nil {
		err = ledger(ctx, tx, account, id, "refund:"+id, "refund", category, item+" · "+in.Reason, amount, "local", map[string]string{"reverses_id": charge, "reason": in.Reason})
	}
	u, _ := identity.UserFromContext(ctx)
	if err == nil {
		err = audit(ctx, tx, u.ID, "refund_charge", id, in)
	}

	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	s.transaction(w, r)
}
