package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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
	pool   *pgxpool.Pool
	now    func() time.Time
	wallet *Wallet
}

func NewService(pool *pgxpool.Pool) *Service     { return &Service{pool: pool, now: time.Now} }
func (s *Service) WithWallet(w *Wallet) *Service { s.wallet = w; return s }
func (s *Service) Initialize(ctx context.Context) error {
	p := defaultPolicy()
	b, _ := json.Marshal(p)
	_, err := s.pool.Exec(ctx, `INSERT INTO settings(key,value,updated_by_user_id) SELECT 'billing',$1,id FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1 ON CONFLICT(key) DO NOTHING`, b)
	return err
}
func (s *Service) policy(ctx context.Context, q resource.Queryer, lock bool) (Policy, error) {
	p := defaultPolicy()
	var raw []byte
	sql := `SELECT value,revision FROM settings WHERE key='billing'`
	if lock {
		sql += " FOR UPDATE"
	}
	var revision int64
	err := q.QueryRow(ctx, sql).Scan(&raw, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return p, fmt.Errorf("读取计费策略: %w", err)
	}
	p.Revision = revision
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
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO audits(actor_type,actor_user_id,actor_name,actor_email,action,category,target_type,target_id,request_params,result,occurred_at) SELECT 'user',id,name,email,$2,'billing','billing',NULLIF($3,'')::uuid,$4,'success',now() FROM users WHERE id=$1`, actor, action, target, b)
	return err
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
	err := q.QueryRow(ctx, `SELECT id,user_id,COALESCE(group_id::text,''),balance::text,frozen::text,quota::text,period_start_at,period_end_at FROM credit_accounts WHERE user_id=$1 AND period_start_at=$2 FOR UPDATE`, user, start).Scan(&a.ID, &a.UserID, &a.GroupID, &b, &f, &v, &a.Start, &a.End)
	if err != nil {
		return a, err
	}
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
	err := q.QueryRow(ctx, `WITH RECURSIVE chain AS (
 SELECT g.id,g.parent_id,0 depth FROM users u JOIN groups g ON g.id=u.billing_group_id WHERE u.id=$1 AND g.deleted_at IS NULL
 UNION ALL SELECT g.id,g.parent_id,c.depth+1 FROM groups g JOIN chain c ON g.id=c.parent_id WHERE g.deleted_at IS NULL AND c.depth<100
 ), choices AS (
 SELECT credits_per_cycle,-1 depth,user_id::text source FROM billing_quotas WHERE user_id=$1 AND deleted_at IS NULL
 UNION ALL SELECT q.credits_per_cycle,c.depth,c.id::text FROM chain c JOIN billing_quotas q ON q.group_id=c.id AND q.deleted_at IS NULL
 UNION ALL SELECT COALESCE((value->>'root_credits')::numeric,15000),101,$2::text FROM settings WHERE key='billing'
 ) SELECT COALESCE((SELECT credits_per_cycle::text FROM choices ORDER BY depth LIMIT 1),'15000'),COALESCE((SELECT id::text FROM chain WHERE depth=0),''),COALESCE((SELECT source FROM choices ORDER BY depth LIMIT 1),$2::text)`, user, rootGroup).Scan(&value, &group, &source)
	if err != nil {
		return 0, "", "", err
	}
	a, err := ParseAmount(value)
	return a, group, source, err
}
func (s *Service) ensureAccount(ctx context.Context, tx pgx.Tx, user string, p Policy) (Account, error) {
	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, user).Scan(&id); err != nil {
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
	err = tx.QueryRow(ctx, `INSERT INTO credit_accounts(user_id,balance,quota,group_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$2,NULLIF($3,'')::uuid,$4,$5,$6) RETURNING id`, user, quota.String(), group, start, end, s.now()).Scan(&account)
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
	_, err = tx.Exec(ctx, `WITH a AS (UPDATE credit_accounts SET sequence=sequence+1,updated_at=now() WHERE id=$1 RETURNING *) INSERT INTO credit_ledger_entries(account_id,user_id,transaction_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at,user_name,user_email,group_id,mode,metadata,reverses_id) SELECT a.id,a.user_id,NULLIF($2,'')::uuid,$3,a.sequence,$4,$5,$6,$7,a.balance,now(),COALESCE(t.user_name,u.name),COALESCE(t.user_email,u.email),a.group_id,$8,$9,NULLIF($9::jsonb->>'reverses_id','')::uuid FROM a JOIN users u ON u.id=a.user_id LEFT JOIN billing_transactions t ON t.id=NULLIF($2,'')::uuid`, account, transaction, event, kind, category, item, delta.String(), mode, raw)
	return err
}

// 配置或归属改变前，先固化尚未开户用户的当期额度。
func (s *Service) PreserveAccounts(ctx context.Context, tx pgx.Tx) error {
	var revision int64
	if err := tx.QueryRow(ctx, `SELECT revision FROM settings WHERE key='billing' FOR SHARE`).Scan(&revision); err != nil {
		return err
	}
	p, err := s.policy(ctx, tx, false)
	if err != nil {
		return err
	}
	start, _ := p.period(s.now())
	rows, err := tx.Query(ctx, `SELECT id FROM users u WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=u.id AND a.period_start_at=$1) ORDER BY id`, start)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err = s.ensureAccount(ctx, tx, id, p); err != nil {
			return err
		}
	}
	return nil
}
