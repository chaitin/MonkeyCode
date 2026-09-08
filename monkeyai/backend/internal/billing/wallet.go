package billing

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"git.in.chaitin.net/ai/baizhiyun/opensdk"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

type WalletClient interface {
	GetUserByID(context.Context, string) (*opensdk.User, error)
	CreateBillingCharge(context.Context, string, *opensdk.CreateBillingChargeReq) error
	ConfirmBillingCharge(context.Context, *opensdk.ConfirmBillingChargeReq) error
	GetUserCreditBalance(context.Context, string) (*opensdk.UserCreditBalance, error)
}
type Wallet struct {
	Client               WalletClient
	Environment          string
	AppID                int
	CertificateExpiresAt time.Time
}

func WalletFromEnv() (*Wallet, error) {
	env := os.Getenv("BAIZHIYUN_ENV")
	if env == "" {
		return nil, nil
	}
	if env != "dev" && env != "prod" {
		return nil, errors.New("BAIZHIYUN_ENV 必须为 dev 或 prod")
	}
	appID, err := strconv.Atoi(os.Getenv("BAIZHIYUN_APP_ID"))
	if err != nil || appID < 1 || appID > 999 {
		return nil, errors.New("BAIZHIYUN_APP_ID 必须在 1 到 999 之间")
	}
	dir := os.Getenv("MONKEYAI_WALLET_CERT_DIR")
	if dir == "" {
		return nil, errors.New("远程计费需配置 MONKEYAI_WALLET_CERT_DIR")
	}
	certPath := filepath.Join(dir, "app.crt")
	data, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("读取钱包证书: %w", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("钱包证书格式无效")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, err
	}
	if time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
		return nil, errors.New("钱包证书不在有效期内")
	}
	client, err := opensdk.NewOpenClientWithConfig(opensdk.OpenClientConfig{Env: env, AppID: appID, PrivateKeyPath: filepath.Join(dir, "app.key"), CertPath: certPath, CAFile: filepath.Join(dir, "ca.crt")})
	if err != nil {
		return nil, err
	}
	return &Wallet{Client: client, Environment: env, AppID: appID, CertificateExpiresAt: cert.NotAfter}, nil
}
func (w *Wallet) BizID() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10_000_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%03d%s%010d", w.AppID, time.Now().Format("20060102150405"), n.Int64()), nil
}
func (s *Service) walletInfo() any {
	if s.wallet == nil {
		return map[string]any{"configured": false}
	}
	return map[string]any{"configured": true, "environment": s.wallet.Environment, "app_id": s.wallet.AppID, "certificate_expires_at": s.wallet.CertificateExpiresAt}
}
func walletFailure(err error) (string, string) {
	code := "wallet_unavailable"
	if errors.Is(err, opensdk.ErrInsufficientBalance) {
		code = "wallet_insufficient_balance"
	}
	if errors.Is(err, opensdk.ErrCreditAccountSuspended) {
		code = "wallet_account_suspended"
	}
	trace := ""
	if e, ok := errors.AsType[*opensdk.WalletError](err); ok {
		trace = e.TraceID
	}
	return code, trace
}
func (s *Service) reserveRemote(ctx context.Context, id string) error {
	var biz, user, env string
	var amount int64
	var app int
	err := s.pool.QueryRow(ctx, `SELECT biz_id,external_user_id,environment,app_id,frozen_amount_quota FROM wallet_billing_records WHERE transaction_id=$1`, id).Scan(&biz, &user, &env, &app, &amount)
	if err != nil {
		return err
	}
	if s.wallet == nil || env != s.wallet.Environment || app != s.wallet.AppID {
		return fail(503, "wallet_configuration_changed", "原交易的钱包配置不可用")
	}
	c, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	profile, err := s.wallet.Client.GetUserByID(c, user)
	team := ""
	if err == nil {
		if profile.Team != nil {
			team = profile.Team.Slug
		}
		_, err = s.pool.Exec(c, `UPDATE wallet_billing_records SET team_slug=$2 WHERE transaction_id=$1`, id, team)
	}
	if err == nil {
		err = s.wallet.Client.CreateBillingCharge(c, user, &opensdk.CreateBillingChargeReq{BizID: biz, FrozenAmountCreditCents: amount})
	}
	finalCtx, finish := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer finish()
	if err != nil {
		code, trace := walletFailure(err)
		definite := errors.Is(err, opensdk.ErrInsufficientBalance) || errors.Is(err, opensdk.ErrCreditAccountSuspended)
		tx, e := s.pool.Begin(finalCtx)
		if e != nil {
			return e
		}
		defer tx.Rollback(finalCtx)
		state := "unknown"
		if definite {
			state = "rejected"
		}
		_, e = tx.Exec(finalCtx, `UPDATE wallet_billing_records SET status=$2,error_code=$3,trace_id=$4,updated_at=now() WHERE transaction_id=$1`, id, state, code, trace)
		if e != nil {
			return e
		}
		_, e = tx.Exec(finalCtx, `UPDATE billing_transactions SET status=$2,error_code=$3,updated_at=now() WHERE id=$1`, id, state, code)
		if e != nil {
			return e
		}
		if definite {
			_, e = tx.Exec(finalCtx, `UPDATE credit_accounts a SET frozen=a.frozen-t.reserve FROM billing_transactions t WHERE t.id=$1 AND a.id=t.account_id`, id)
			if e != nil {
				return e
			}
		}
		if e = tx.Commit(finalCtx); e != nil {
			return e
		}
		status := 503
		if definite {
			status = 402
		}
		return fail(status, code, "百智云预扣未完成，请查看交易状态")
	}
	tx, err := s.pool.Begin(finalCtx)
	if err != nil {
		return err
	}
	defer tx.Rollback(finalCtx)
	_, err = tx.Exec(finalCtx, `UPDATE wallet_billing_records SET status='reserved',updated_at=now() WHERE transaction_id=$1`, id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(finalCtx, `UPDATE billing_transactions SET status='reserved',updated_at=now() WHERE id=$1 AND status='created'`, id)
	if err != nil {
		return err
	}
	return tx.Commit(finalCtx)
}
func (s *Service) confirmRemote(ctx context.Context, conn *pgxpool.Conn, id string) error {
	var biz, user, team, env, state, item, amountText string
	var app int
	err := conn.QueryRow(ctx, `SELECT w.biz_id,w.external_user_id,w.team_slug,w.environment,w.app_id,w.status,t.item_name,t.amount::text FROM wallet_billing_records w JOIN billing_transactions t ON t.id=w.transaction_id WHERE t.id=$1`, id).Scan(&biz, &user, &team, &env, &app, &state, &item, &amountText)
	if err != nil {
		return err
	}
	if state == "confirmed" {
		return nil
	}
	if s.wallet == nil || env != s.wallet.Environment || app != s.wallet.AppID {
		return fail(503, "wallet_configuration_changed", "原交易的钱包配置不可用")
	}
	amount, err := ParseAmount(amountText)
	if err != nil {
		return err
	}
	// SDK 对个人账户确认时会重新解析所属团队，身份变化必须先核查。
	if team == "" {
		profile, e := s.wallet.Client.GetUserByID(ctx, user)
		if e != nil {
			return e
		}
		if profile.Team != nil && profile.Team.Slug != "" {
			return fail(409, "wallet_identity_changed", "钱包归属已改变，需核查原交易")
		}
	}
	_, err = conn.Exec(ctx, `UPDATE wallet_billing_records SET status='confirming',actual_amount_quota=$2,confirmation_status='success',updated_at=now() WHERE transaction_id=$1`, id, quotaAmount(amount, false))
	if err != nil {
		return err
	}
	err = s.wallet.Client.ConfirmBillingCharge(ctx, &opensdk.ConfirmBillingChargeReq{BizID: biz, UserID: user, TeamSlug: team, Status: "success", ActualAmountCreditCents: quotaAmount(amount, false), Subject: item})
	if err != nil {
		code, trace := walletFailure(err)
		_, _ = conn.Exec(ctx, `UPDATE wallet_billing_records SET error_code=$2,trace_id=$3,updated_at=now() WHERE transaction_id=$1`, id, code, trace)
		_, _ = conn.Exec(ctx, `UPDATE billing_transactions SET error_code=$2 WHERE id=$1`, id, code)
		return fail(503, code, "百智云确认待重试")
	}
	_, err = conn.Exec(ctx, `UPDATE wallet_billing_records SET status='confirmed',error_code='',confirmed_at=now(),updated_at=now() WHERE transaction_id=$1`, id)
	return err
}
func (s *Service) BindWallet(ctx context.Context, actor, user, external string) error {
	if s.wallet == nil {
		return fail(503, "wallet_unavailable", "未配置百智云计费连接")
	}
	if external == "" || len(external) > 128 {
		return resource.Invalid("百智云用户 ID 无效")
	}
	c, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	profile, err := s.wallet.Client.GetUserByID(c, external)
	if err != nil {
		return fail(422, "wallet_user_invalid", "无法核实百智云用户")
	}
	if profile.ID != external {
		return resource.Invalid("百智云用户 ID 不匹配")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var current string
	if err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, user).Scan(&current); err != nil {
		return err
	}
	var pending bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM billing_transactions WHERE user_id=$1 AND mode='remote' AND status NOT IN ('settled','released','rejected'))`, user).Scan(&pending); err != nil {
		return err
	}
	if pending {
		return fail(409, "wallet_transactions_pending", "用户有未完成的远程交易，暂不能变更绑定")
	}
	_, err = tx.Exec(ctx, `INSERT INTO wallet_user_bindings(user_id,external_user_id,verified_at,updated_by_user_id) VALUES($1,$2,now(),$3) ON CONFLICT(user_id) DO UPDATE SET external_user_id=EXCLUDED.external_user_id,verified_at=now(),updated_by_user_id=EXCLUDED.updated_by_user_id`, user, external, actor)
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "bind_wallet", user, map[string]string{"external_user_id": external}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
