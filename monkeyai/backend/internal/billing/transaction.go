package billing

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

type Request struct {
	UserID, ResourceID, ConnectorID, SessionID, Category string
	IdempotencyKey, RequestHash                          string
	OutputLimit                                          int64
}
type Reservation struct {
	ID          string
	OutputLimit int64
}
type Usage struct {
	Input     int64  `json:"input_tokens"`
	Cached    int64  `json:"cached_input_tokens"`
	Output    int64  `json:"output_tokens"`
	Known     bool   `json:"known"`
	Result    string `json:"result"`
	RequestID string `json:"request_id,omitempty"`
	ErrorCode string `json:"error_code,omitempty"`
}

func (s *Service) Begin(ctx context.Context, r Request) (Reservation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Reservation{}, err
	}
	defer tx.Rollback(ctx)
	p, err := s.policy(ctx, tx, false)
	if err != nil {
		return Reservation{}, err
	}
	a, err := s.ensureAccount(ctx, tx, r.UserID, p)
	if err != nil {
		return Reservation{}, err
	}
	var name, email, status string
	var record sqlc.BillingUserRow
	record, err = sqlc.New(tx).BillingUser(ctx, r.UserID)
	if err != nil {
		return Reservation{}, err
	}
	name, email, status = record.Name, record.Email, record.Status

	if status != "active" {
		return Reservation{}, fail(403, "user_disabled", "用户已停用")
	}
	if r.IdempotencyKey != "" {
		if len(r.IdempotencyKey) > 128 {
			return Reservation{}, resource.Invalid("幂等键过长")
		}
		var existing, hash string
		existingTransaction, e := sqlc.New(tx).IdempotentTransaction(ctx, sqlc.IdempotentTransactionParams{UserID: r.UserID, Category: r.Category, IdempotencyKey: new(r.IdempotencyKey)})
		if e == nil {
			existing, hash = existingTransaction.ID, existingTransaction.RequestHash
		}

		if e == nil {
			code := "request_already_accepted"
			if hash != r.RequestHash {
				code = "idempotency_conflict"
			}
			return Reservation{}, &resource.Error{Status: 409, Code: code, Message: "该幂等键已受理，请查看原交易", References: map[string]string{"transaction_id": existing}}
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return Reservation{}, e
		}
	}
	var blocked bool
	blocked, err = sqlc.New(tx).HasExceededReservation(ctx, r.UserID)
	if err != nil {
		return Reservation{}, err
	}

	if blocked {
		return Reservation{}, fail(409, "billing_review_required", "有超出预留金额的交易待核查")
	}
	if r.SessionID != "" {
		var ok bool
		ok, err = sqlc.New(tx).SessionOwned(ctx, sqlc.SessionOwnedParams{ID: r.SessionID, OwnerUserID: r.UserID})

		if err != nil {
			return Reservation{}, err
		}
		if !ok {
			return Reservation{}, fail(403, "invalid_session", "会话不属于当前用户")
		}
	}
	price := Price{Input: p.Input, Cached: p.Cached, Output: p.Output}
	var item string
	var reserve Amount
	limit := r.OutputLimit
	switch r.Category {
	case "model":
		var multiplier string
		var capacity, maxOutput int64
		var row sqlc.ModelPricingRow
		row, err = sqlc.New(tx).ModelPricing(ctx, r.ResourceID)
		if err == nil {
			item, multiplier, capacity, maxOutput = row.DisplayName, row.CreditMultiplier, row.ContextWindowTokens, row.MaxOutputTokens
		}
		if err != nil {
			return Reservation{}, err
		}
		price.Multiplier, err = ParseAmount(multiplier)
		if err != nil {
			return Reservation{}, err
		}
		if p.Enabled {
			if capacity <= 0 || maxOutput <= 0 || capacity > 100_000_000 || maxOutput > capacity {
				return Reservation{}, fail(422, "model_limits_required", "计费模型需要有效的上下文与最大输出限制")
			}
			if limit < 0 {
				return Reservation{}, resource.Invalid("输出上限无效")
			}
			if limit == 0 || limit > maxOutput {
				limit = maxOutput
			}
			upper := price
			if upper.Cached > upper.Input {
				upper.Input = upper.Cached
			}
			reserve, err = priceTokens(capacity, 0, limit, upper)
			if err != nil {
				return Reservation{}, err
			}
		}
	case "tool":
		var credits, auth string
		var row sqlc.ToolPricingRow
		row, err = sqlc.New(tx).ToolPricing(ctx, sqlc.ToolPricingParams{ID: r.ResourceID, ConnectorID: r.ConnectorID})
		if err == nil {
			item, credits, auth = row.Name, row.TCreditsPerCall, row.AuthorizationMode
		}
		if err != nil {
			return Reservation{}, err
		}
		if auth == "centralized" && p.Enabled {
			price.Tool, err = ParseAmount(credits)
			if err != nil {
				return Reservation{}, err
			}
			reserve = price.Tool
		}
	default:
		return Reservation{}, resource.Invalid("计费类型无效")
	}
	if !p.Enabled {
		price = Price{}
	}
	mode := p.Mode
	if !p.Enabled || reserve == 0 {
		mode = "local"
	}
	if mode == "remote" {
		if s.wallet == nil {
			return Reservation{}, fail(503, "wallet_unavailable", "未配置百智云计费连接")
		}
		reserve = Amount(quotaAmount(reserve, true) * 10000)
	}
	if a.Available < reserve {
		return Reservation{}, insufficient
	}
	var walletUser, team, biz string
	if mode == "remote" {
		walletUser, err = sqlc.New(tx).WalletUser(ctx, r.UserID)

		if errors.Is(err, pgx.ErrNoRows) {
			return Reservation{}, fail(422, "wallet_user_unbound", "用户尚未绑定百智云身份")
		}
		if err != nil {
			return Reservation{}, err
		}
		biz, err = s.wallet.BizID()
		if err != nil {
			return Reservation{}, err
		}
	}
	snapshot, _ := json.Marshal(price)
	id := resource.ID()

	_, err = sqlc.New(tx).FreezeBalance(ctx, sqlc.FreezeBalanceParams{ID: a.ID, Frozen: reserve.String()})
	if err != nil {
		return Reservation{}, err
	}
	state := "reserved"
	if mode == "remote" {
		state = "created"
	}
	_, err = sqlc.New(tx).CreateTransaction(ctx, sqlc.CreateTransactionParams{
		ID:             id,
		UserID:         r.UserID,
		AccountID:      a.ID,
		SessionID:      r.SessionID,
		Category:       r.Category,
		ResourceID:     r.ResourceID,
		ConnectorID:    r.ConnectorID,
		ItemName:       item,
		UserName:       name,
		UserEmail:      email,
		GroupID:        a.GroupID,
		Mode:           mode,
		Status:         state,
		Reserve:        reserve.String(),
		Pricing:        snapshot,
		IdempotencyKey: r.IdempotencyKey,
		RequestHash:    r.RequestHash,
		StartedAt:      s.now(),
	})
	if err != nil {
		return Reservation{}, err
	}
	if mode == "remote" {
		_, err = sqlc.New(tx).CreateWalletRecord(ctx, sqlc.CreateWalletRecordParams{
			BizID:             biz,
			TransactionID:     id,
			ExternalUserID:    walletUser,
			TeamSlug:          team,
			Environment:       s.wallet.Environment,
			AppID:             int32(s.wallet.AppID),
			FrozenAmountQuota: int64(quotaAmount(reserve, true)),
		})
		if err != nil {
			return Reservation{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Reservation{}, err
	}
	if mode == "remote" {
		if err = s.reserveRemote(ctx, id); err != nil {
			return Reservation{}, err
		}
	}
	return Reservation{ID: id, OutputLimit: limit}, nil
}
func (s *Service) Start(ctx context.Context, id string) error {
	tag, err := sqlc.New(s.pool).StartTransaction(ctx, id)
	if err == nil && tag.RowsAffected() != 1 {
		return fail(409, "invalid_transaction_state", "交易不可执行")
	}
	return err
}
func (s *Service) Finish(ctx context.Context, id string, u Usage) error {
	if u.Result != "succeeded" && u.Result != "failed" && u.Result != "cancelled" {
		return resource.Invalid("调用结果无效")
	}
	if u.Input < 0 || u.Output < 0 || u.Cached < 0 || u.Cached > u.Input {
		return resource.Invalid("Token 用量无效")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var category, mode, status, reserveText string
	var raw []byte
	var record sqlc.LockUsageRow
	record, err = sqlc.New(tx).LockUsage(ctx, id)

	if err != nil {
		return err
	}
	_, category, mode, status, reserveText, raw = record.AccountID, record.Category, record.Mode, record.Status, record.Reserve, record.Pricing

	if status == "settled" || status == "released" || status == "rejected" || status == "settling" {
		return nil
	}
	if status != "running" && status != "reserved" && status != "unknown" {
		return fail(409, "invalid_transaction_state", "交易尚未完成预留")
	}
	p := Price{}
	if err = json.Unmarshal(raw, &p); err != nil {
		return err
	}
	reserve, err := ParseAmount(reserveText)
	if err != nil {
		return err
	}
	var amount Amount
	if category == "model" {
		amount, err = priceTokens(u.Input, u.Cached, u.Output, p)
	} else if u.Result == "succeeded" {
		amount = p.Tool
	}
	if err != nil {
		return err
	}
	actual := amount
	if mode == "remote" {
		actual = Amount(quotaAmount(amount, false) * 10000)
	}
	state := "settling"
	code := u.ErrorCode
	if !u.Known {
		state = "unknown"
		if code == "" {
			code = "usage_unknown"
		}
	}
	if actual > reserve {
		state = "unknown"
		code = "reservation_exceeded"
	}
	usage, _ := json.Marshal(u)
	_, err = sqlc.New(tx).SaveUsage(ctx, sqlc.SaveUsageParams{
		ID:          id,
		Status:      state,
		Amount:      new(actual.String()),
		RawAmount:   new(amount.String()),
		Usage:       usage,
		Result:      new(u.Result),
		ErrorCode:   code,
		RequestID:   u.RequestID,
		CompletedAt: new(s.now()),
	})
	if err != nil {
		return err
	}
	if category == "model" {
		_, err = sqlc.New(tx).UpsertModelCall(ctx, sqlc.UpsertModelCallParams{ID: id, InputTokens: int64(u.Input), CachedInputTokens: int64(u.Cached), OutputTokens: int64(u.Output)})
	} else {
		_, err = sqlc.New(tx).UpsertToolCall(ctx, id)
	}
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if state == "unknown" {
		return nil
	}
	return s.Settle(ctx, id)
}
func (s *Service) Settle(ctx context.Context, id string) error {
	// 会话级 advisory lock 覆盖远程请求；不持有账户行锁等待外部服务。
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var locked bool
	locked, err = sqlc.New(conn).TrySettlementLock(ctx, id)

	if err != nil {
		return err
	}
	if !locked {
		return nil
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, e := sqlc.New(conn).ReleaseSettlementLock(c, id); e != nil {
			conn.Conn().Close(c)
		}
	}()
	var mode, status string
	var existingTransaction sqlc.SettlementStatusRow
	existingTransaction, err = sqlc.New(conn).SettlementStatus(ctx, id)
	if err != nil {
		return err
	}
	mode, status = existingTransaction.Mode, existingTransaction.Status

	if status != "settling" {
		return nil
	}
	if mode == "remote" {
		if err = s.confirmRemote(ctx, conn, id); err != nil {
			return err
		}
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var account, item, category, amountText, reserveText string
	var settlement sqlc.LockSettlementRow
	settlement, err = sqlc.New(tx).LockSettlement(ctx, id)

	if err != nil {
		return err
	}
	account, item, category, amountText, reserveText, status = settlement.AccountID, settlement.ItemName, settlement.Category, settlement.Amount, settlement.Reserve, settlement.Status

	if status != "settling" {
		return nil
	}
	amount, err := ParseAmount(amountText)
	if err != nil {
		return err
	}
	reserve, err := ParseAmount(reserveText)
	if err != nil {
		return err
	}
	_, err = sqlc.New(tx).ChargeBalance(ctx, sqlc.ChargeBalanceParams{ID: account, Balance: amount.String(), Frozen: reserve.String()})
	if err != nil {
		return err
	}
	if amount > 0 {
		if err = ledger(ctx, tx, account, id, "charge:"+id, "charge", category, item, -amount, mode, map[string]string{"transaction_id": id}); err != nil {
			return err
		}
	}
	_, err = sqlc.New(tx).CompleteSettlement(ctx, id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) Release(ctx context.Context, id, reason string) error {
	return s.Finish(ctx, id, Usage{Known: true, Result: "failed", ErrorCode: reason})
}
func (s *Service) recover(ctx context.Context) error {
	_, err := sqlc.New(s.pool).MarkInterrupted(ctx)
	if err != nil {
		return err
	}
	rows, err := sqlc.New(s.pool).TransactionsToRetry(ctx)
	if err != nil {
		return err
	}
	ids := rows
	for _, id := range ids {
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		e := s.Settle(c, id)
		cancel()
		if e != nil {
			_, _ = sqlc.New(s.pool).ScheduleRetry(ctx, id)
		}
	}
	return nil
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := s.recover(ctx); err != nil {
			slog.ErrorContext(ctx, "恢复计费交易失败", "error", err)
		}
		if err := s.refresh(ctx); err != nil {
			slog.ErrorContext(ctx, "刷新周期账户失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) refresh(ctx context.Context) error {
	p, err := s.Policy(ctx)
	if err != nil {
		return err
	}
	start, _ := p.period(s.now())
	rows, err := sqlc.New(s.pool).ActiveUsersWithoutAccount(ctx, start)
	if err != nil {
		return err
	}
	ids := rows
	for _, id := range ids {
		if _, err = s.Account(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
