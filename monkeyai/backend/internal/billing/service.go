package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	auditlog "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const rootGroup = "team"

type Price struct {
	Input      Amount `json:"input"`
	Cached     Amount `json:"cached"`
	Output     Amount `json:"output"`
	Multiplier Amount `json:"multiplier"`
	Tool       Amount `json:"tool"`
}
type Policy struct {
	RootCredits      Amount     `json:"root_credits"`
	Input            Amount     `json:"input_credits_per_million_tokens"`
	Cached           Amount     `json:"cached_input_credits_per_million_tokens"`
	Output           Amount     `json:"output_credits_per_million_tokens"`
	Cycle            string     `json:"quota_refresh_cycle"`
	Mode             string     `json:"charging_mode"`
	Enabled          bool       `json:"enabled"`
	PendingCycle     string     `json:"pending_cycle,omitempty"`
	CycleEffectiveAt *time.Time `json:"cycle_effective_at,omitempty"`
	CycleAnchor      *time.Time `json:"cycle_anchor,omitempty"`
	Revision         int64      `json:"revision"`
}

func defaultPolicy() Policy {
	return Policy{RootCredits: 15000 * Amount(scale), Input: 100 * Amount(scale), Cached: 20 * Amount(scale), Output: 400 * Amount(scale), Cycle: "monthly", Mode: "local"}
}
func (p Policy) period(now time.Time) (time.Time, time.Time) {
	zone, _ := time.LoadLocation("Asia/Shanghai")
	n := now.In(zone)
	cycle := p.Cycle
	anchor := p.CycleAnchor
	if p.CycleEffectiveAt != nil && !now.Before(*p.CycleEffectiveAt) {
		cycle = p.PendingCycle
		anchor = p.CycleEffectiveAt
	}
	start := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, zone)
	var end time.Time
	switch cycle {
	case "daily":
		end = start.AddDate(0, 0, 1)
	case "weekly":
		start = start.AddDate(0, 0, -(int(n.Weekday())+6)%7)
		end = start.AddDate(0, 0, 7)
	default:
		start = time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, zone)
		end = start.AddDate(0, 1, 0)
	}
	if anchor != nil && start.Before(*anchor) && now.Before(end) {
		start = anchor.In(zone)
	}
	return start.UTC(), end.UTC()
}

type Service struct {
	pool         *pgxpool.Pool
	now          func() time.Time
	fallback     *Wallet
	walletMu     sync.Mutex
	cachedWallet *Wallet
}

func NewService(pool *pgxpool.Pool) *Service     { return &Service{pool: pool, now: time.Now} }
func (s *Service) WithWallet(w *Wallet) *Service { s.fallback = w; return s }
func (s *Service) Initialize(ctx context.Context) error {
	p := defaultPolicy()
	b, _ := json.Marshal(p)
	_, err := sqlc.New(s.pool).InitializePolicy(ctx, b)
	if err != nil {
		return err
	}
	cfg, err := s.walletConfig(ctx, s.pool)
	if err == nil && cfg == nil && s.fallback == nil {
		s.fallback, err = WalletFromEnv()
	}
	return err
}
func (s *Service) policy(ctx context.Context, q resource.Queryer, lock bool) (Policy, error) {
	p := defaultPolicy()
	var record sqlc.Setting
	var err error
	queries := sqlc.New(q)
	if lock {
		record, err = queries.LockPolicy(ctx)
	} else {
		record, err = queries.GetPolicy(ctx)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(record.Value, &p); err != nil {
		return p, fmt.Errorf("读取计费策略: %w", err)
	}
	p.Revision = record.Revision
	if p.CycleEffectiveAt != nil && !s.now().Before(*p.CycleEffectiveAt) {
		p.Cycle = p.PendingCycle
		p.CycleAnchor = p.CycleEffectiveAt
		p.PendingCycle = ""
		p.CycleEffectiveAt = nil
	}
	return p, nil
}
func (s *Service) Policy(ctx context.Context) (Policy, error) { return s.policy(ctx, s.pool, false) }
func fail(status int, code, message string) error {
	return &resource.Error{Status: status, Code: code, Message: message}
}

var insufficient = fail(402, "insufficient_credits", "当期可用积分不足")
var conflict = fail(409, "revision_conflict", "配置已更新，请重新加载后保存")

func audit(ctx context.Context, q resource.Queryer, actor, action, target string, data any) error {
	return auditlog.Write(ctx, q, auditlog.Event{ActorID: actor, Action: action, Category: "billing", TargetType: "billing", TargetID: target, Params: data})
}

type Account struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	GroupID   string    `json:"group_id"`
	Balance   Amount    `json:"balance"`
	Frozen    Amount    `json:"frozen"`
	Available Amount    `json:"available"`
	Quota     Amount    `json:"quota"`
	Start     time.Time `json:"period_start_at"`
	End       time.Time `json:"period_end_at"`
}

func accountRow(ctx context.Context, q resource.Queryer, user string, start time.Time) (Account, error) {
	var a Account
	var b, f, v string
	record, err := sqlc.New(q).LockAccount(ctx, sqlc.LockAccountParams{UserID: user, PeriodStartAt: start})

	if err != nil {
		return a, err
	}
	a.ID, a.UserID, a.GroupID, b, f, v, a.Start, a.End = record.ID, record.UserID, record.GroupID, record.Balance, record.Frozen, record.Quota, record.PeriodStartAt, record.PeriodEndAt

	var e error
	a.Balance, e = ParseAmount(b)
	if e != nil {
		return a, e
	}
	a.Frozen, e = ParseAmount(f)
	if e != nil {
		return a, e
	}
	a.Quota, e = ParseAmount(v)
	a.Available = a.Balance - a.Frozen
	return a, e
}
func effectiveQuota(ctx context.Context, q resource.Queryer, user string) (Amount, string, string, error) {
	var value, group, source string
	record, err := sqlc.New(q).EffectiveQuota(ctx, sqlc.EffectiveQuotaParams{ID: user, RootGroup: rootGroup})

	if err != nil {
		return 0, "", "", err
	}
	value, group, source = record.Credits, record.GroupID, record.Source

	a, err := ParseAmount(value)
	return a, group, source, err
}
func (s *Service) ensureAccount(ctx context.Context, tx pgx.Tx, user string, p Policy) (Account, error) {
	_, err := sqlc.New(tx).LockUser(ctx, user)
	if err != nil {
		return Account{}, err
	}

	start, end := p.period(s.now())
	a, err := accountRow(ctx, tx, user, start)
	if err == nil {
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return a, err
	}
	quota, group, _, err := effectiveQuota(ctx, tx, user)
	if err != nil {
		return a, err
	}
	var account string
	account, err = sqlc.New(tx).CreateAccount(ctx, sqlc.CreateAccountParams{
		UserID:          user,
		Balance:         quota.String(),
		GroupID:         group,
		PeriodStartAt:   start,
		PeriodEndAt:     end,
		LastRefreshedAt: s.now(),
	})

	if err != nil {
		return a, err
	}
	if err = ledger(ctx, tx, account, "", "grant:"+account, "grant", "other", "周期额度发放", quota, "local", nil); err != nil {
		return a, err
	}
	return accountRow(ctx, tx, user, start)
}
func (s *Service) Account(ctx context.Context, user string) (Account, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback(ctx)
	p, err := s.policy(ctx, tx, false)
	if err != nil {
		return Account{}, err
	}
	a, err := s.ensureAccount(ctx, tx, user, p)
	if err != nil {
		return a, err
	}
	return a, tx.Commit(ctx)
}
func ledger(ctx context.Context, tx pgx.Tx, account, transaction, event, kind, category, item string, delta Amount, mode string, metadata any) error {
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if metadata == nil {
		raw = []byte("{}")
	}
	_, err = sqlc.New(tx).AppendLedger(ctx, sqlc.AppendLedgerParams{
		ID:            account,
		TransactionID: transaction,
		EventKey:      new(event),
		EntryType:     kind,
		Category:      category,
		ItemName:      item,
		CreditDelta:   delta.String(),
		Mode:          mode,
		Metadata:      raw,
	})
	return err
}

// 配置或归属改变前，先固化尚未开户用户的当期额度。
func (s *Service) PreserveAccounts(ctx context.Context, tx pgx.Tx) error {
	_, err := sqlc.New(tx).SharePolicy(ctx)
	if err != nil {
		return err
	}

	p, err := s.policy(ctx, tx, false)
	if err != nil {
		return err
	}
	start, _ := p.period(s.now())
	rows, err := sqlc.New(tx).UsersWithoutAccount(ctx, start)
	if err != nil {
		return err
	}
	ids := rows
	for _, id := range ids {
		if _, err = s.ensureAccount(ctx, tx, id, p); err != nil {
			return err
		}
	}
	return nil
}
