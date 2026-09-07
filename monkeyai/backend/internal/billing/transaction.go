package billing

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

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
	if err = tx.QueryRow(ctx, `SELECT name,email,status FROM users WHERE id=$1`, r.UserID).Scan(&name, &email, &status); err != nil {
		return Reservation{}, err
	}
	if status != "active" {
		return Reservation{}, fail(403, "user_disabled", "用户已停用")
	}
	if r.IdempotencyKey != "" {
		if len(r.IdempotencyKey) > 128 {
			return Reservation{}, resource.Invalid("幂等键过长")
		}
		var existing, hash string
		e := tx.QueryRow(ctx, `SELECT id,request_hash FROM billing_transactions WHERE user_id=$1 AND category=$2 AND idempotency_key=$3`, r.UserID, r.Category, r.IdempotencyKey).Scan(&existing, &hash)
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
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM billing_transactions WHERE user_id=$1 AND status='unknown' AND error_code='reservation_exceeded')`, r.UserID).Scan(&blocked); err != nil {
		return Reservation{}, err
	}
	if blocked {
		return Reservation{}, fail(409, "billing_review_required", "有超出预留金额的交易待核查")
	}
	if r.SessionID != "" {
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, r.SessionID, r.UserID).Scan(&ok)
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
		err = tx.QueryRow(ctx, `SELECT display_name,credit_multiplier::text,COALESCE((advanced_config->>'context_window_tokens')::bigint,0),COALESCE((advanced_config->>'max_output_tokens')::bigint,0) FROM models WHERE id=$1 AND enabled AND deleted_at IS NULL`, r.ResourceID).Scan(&item, &multiplier, &capacity, &maxOutput)
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
		err = tx.QueryRow(ctx, `SELECT t.name,t.credits_per_call::text,c.authorization_mode FROM mcp_tools t JOIN connectors c ON c.id=t.connector_id WHERE t.id=$1 AND c.id=$2 AND t.enabled AND t.deleted_at IS NULL AND c.deleted_at IS NULL`, r.ResourceID, r.ConnectorID).Scan(&item, &credits, &auth)
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
		err = tx.QueryRow(ctx, `SELECT external_user_id FROM wallet_user_bindings WHERE user_id=$1`, r.UserID).Scan(&walletUser)
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

	_, err = tx.Exec(ctx, `UPDATE credit_accounts SET frozen=frozen+$2,updated_at=now() WHERE id=$1`, a.ID, reserve.String())
	if err != nil {
		return Reservation{}, err
	}
	state := "reserved"
	if mode == "remote" {
		state = "created"
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_transactions(id,user_id,account_id,session_id,category,resource_id,connector_id,item_name,user_name,user_email,group_id,mode,status,reserve,pricing,idempotency_key,request_hash,started_at) VALUES($1,$2,$3,NULLIF($4,'')::uuid,$5,$6,NULLIF($7,'')::uuid,$8,$9,$10,NULLIF($11,'')::uuid,$12,$13,$14,$15,NULLIF($16,''),$17,$18)`, id, r.UserID, a.ID, r.SessionID, r.Category, r.ResourceID, r.ConnectorID, item, name, email, a.GroupID, mode, state, reserve.String(), snapshot, r.IdempotencyKey, r.RequestHash, s.now())
	if err != nil {
		return Reservation{}, err
	}
	if mode == "remote" {
		_, err = tx.Exec(ctx, `INSERT INTO wallet_billing_records(biz_id,transaction_id,external_user_id,team_slug,environment,app_id,status,frozen_amount_quota) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)`, biz, id, walletUser, team, s.wallet.Environment, s.wallet.AppID, quotaAmount(reserve, true))
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
	tag, err := s.pool.Exec(ctx, `UPDATE billing_transactions SET status='running',updated_at=now() WHERE id=$1 AND status='reserved'`, id)
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
	var account, category, mode, status, reserveText string
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT account_id,category,mode,status,reserve::text,pricing FROM billing_transactions WHERE id=$1 FOR UPDATE`, id).Scan(&account, &category, &mode, &status, &reserveText, &raw)
	if err != nil {
		return err
	}
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
	_, err = tx.Exec(ctx, `UPDATE billing_transactions SET status=$2,amount=$3,raw_amount=$4,usage=$5,result=$6,error_code=$7,request_id=$8,completed_at=$9,updated_at=now(),next_retry_at=now() WHERE id=$1`, id, state, actual.String(), amount.String(), usage, u.Result, code, u.RequestID, s.now())
	if err != nil {
		return err
	}
	if category == "model" {
		_, err = tx.Exec(ctx, `INSERT INTO model_calls(id,session_id,user_id,model_id,request_id,status,input_tokens,cached_input_tokens,output_tokens,cache_hit,error_code,started_at,completed_at) SELECT id,session_id,user_id,resource_id,NULLIF(request_id,''),result,$2::bigint,$3::bigint,$4::bigint,$3::bigint>0,NULLIF(error_code,''),started_at,completed_at FROM billing_transactions WHERE id=$1 ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,input_tokens=EXCLUDED.input_tokens,cached_input_tokens=EXCLUDED.cached_input_tokens,output_tokens=EXCLUDED.output_tokens,cache_hit=EXCLUDED.cache_hit,error_code=EXCLUDED.error_code,completed_at=EXCLUDED.completed_at`, id, u.Input, u.Cached, u.Output)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO mcp_tool_calls(id,session_id,user_id,connector_id,tool_id,request_id,status,error_code,started_at,completed_at) SELECT id,session_id,user_id,connector_id,resource_id,NULLIF(request_id,''),result,NULLIF(error_code,''),started_at,completed_at FROM billing_transactions WHERE id=$1 ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,error_code=EXCLUDED.error_code,completed_at=EXCLUDED.completed_at`, id)
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
	err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,41))`, id).Scan(&locked)
	if err != nil {
		return err
	}
	if !locked {
		return nil
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, e := conn.Exec(c, `SELECT pg_advisory_unlock(hashtextextended($1,41))`, id); e != nil {
			conn.Conn().Close(c)
		}
	}()
	var mode, status string
	if err = conn.QueryRow(ctx, `SELECT mode,status FROM billing_transactions WHERE id=$1`, id).Scan(&mode, &status); err != nil {
		return err
	}
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
	err = tx.QueryRow(ctx, `SELECT account_id,item_name,category,amount::text,reserve::text,status FROM billing_transactions WHERE id=$1 FOR UPDATE`, id).Scan(&account, &item, &category, &amountText, &reserveText, &status)
	if err != nil {
		return err
	}
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
	_, err = tx.Exec(ctx, `UPDATE credit_accounts SET balance=balance-$2,frozen=frozen-$3,updated_at=now() WHERE id=$1`, account, amount.String(), reserve.String())
	if err != nil {
		return err
	}
	if amount > 0 {
		if err = ledger(ctx, tx, account, id, "charge:"+id, "charge", category, item, -amount, mode, map[string]string{"transaction_id": id}); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE billing_transactions SET status=CASE WHEN amount=0 AND result<>'succeeded' THEN 'released' ELSE 'settled' END,error_code='',next_retry_at=NULL,updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) Release(ctx context.Context, id, reason string) error {
	return s.Finish(ctx, id, Usage{Known: true, Result: "failed", ErrorCode: reason})
}
func (s *Service) recover(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `UPDATE billing_transactions SET status='unknown',error_code='execution_interrupted',updated_at=now() WHERE status IN ('running','reserved','created') AND updated_at < now()-interval '30 minutes'`)
	if err != nil {
		return err
	}
	rows, err := s.pool.Query(ctx, `SELECT id FROM billing_transactions WHERE status='settling' AND (next_retry_at IS NULL OR next_retry_at<=now()) ORDER BY started_at LIMIT 100`)
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
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		e := s.Settle(c, id)
		cancel()
		if e != nil {
			_, _ = s.pool.Exec(ctx, `UPDATE billing_transactions SET attempts=attempts+1,next_retry_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7)))::int) WHERE id=$1`, id)
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
	rows, err := s.pool.Query(ctx, `SELECT id FROM users u WHERE status='active' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=u.id AND a.period_start_at=$1) ORDER BY id LIMIT 100`, start)
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
		if _, err = s.Account(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
