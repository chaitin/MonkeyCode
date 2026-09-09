package billing

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"git.in.chaitin.net/ai/baizhiyun/opensdk"
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
	BaseURL              string
	AppID                int
	CertificateExpiresAt time.Time
	config               WalletConfig
	validUntil           time.Time
	error                string
	source               string
}

func (w *Wallet) BizID() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10_000_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%03d%s%010d", w.AppID, time.Now().Format("20060102150405"), n.Int64()), nil
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
	var biz, user string
	var amount int64
	var app int
	record, err := sqlc.New(s.pool).WalletReservation(ctx, id)

	if err != nil {
		return err
	}
	biz, user, app, amount = record.BizID, record.ExternalUserID, int(record.AppID), record.FrozenAmountQuota

	wallet, err := s.wallet(ctx, s.pool)
	if err != nil {
		return err
	}
	if !wallet.ready() || record.BaseUrl != wallet.BaseURL || app != wallet.AppID {
		return fail(503, "wallet_configuration_changed", "原交易的钱包配置不可用")
	}
	c, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	profile, err := wallet.Client.GetUserByID(c, user)
	team := ""
	if err == nil {
		if profile.Team != nil {
			team = profile.Team.Slug
		}
		_, err = sqlc.New(s.pool).SetWalletTeam(c, sqlc.SetWalletTeamParams{TransactionID: id, TeamSlug: team})
	}
	if err == nil {
		err = wallet.Client.CreateBillingCharge(c, user, &opensdk.CreateBillingChargeReq{BizID: biz, FrozenAmountCreditCents: amount})
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
		_, e = sqlc.New(tx).SetWalletStatus(finalCtx, sqlc.SetWalletStatusParams{TransactionID: id, Status: state, ErrorCode: code, TraceID: trace})
		if e != nil {
			return e
		}
		_, e = sqlc.New(tx).SetTransactionStatus(finalCtx, sqlc.SetTransactionStatusParams{ID: id, Status: state, ErrorCode: code})
		if e != nil {
			return e
		}
		if definite {
			_, e = sqlc.New(tx).ReleaseFrozenBalance(finalCtx, id)
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
	_, err = sqlc.New(tx).MarkWalletReserved(finalCtx, id)
	if err != nil {
		return err
	}
	_, err = sqlc.New(tx).MarkReserved(finalCtx, id)
	if err != nil {
		return err
	}
	return tx.Commit(finalCtx)
}
func (s *Service) confirmRemote(ctx context.Context, conn *pgxpool.Conn, id string) error {
	var biz, user, team, state, item, amountText string
	var app int
	record, err := sqlc.New(conn).WalletConfirmation(ctx, id)

	if err != nil {
		return err
	}
	biz, user, team, app, state, item, amountText = record.BizID, record.ExternalUserID, record.TeamSlug, int(record.AppID), record.Status, record.ItemName, record.TAmount

	if state == "confirmed" {
		return nil
	}
	wallet, err := s.wallet(ctx, conn)
	if err != nil {
		return err
	}
	if !wallet.ready() || record.BaseUrl != wallet.BaseURL || app != wallet.AppID {
		return fail(503, "wallet_configuration_changed", "原交易的钱包配置不可用")
	}
	amount, err := ParseAmount(amountText)
	if err != nil {
		return err
	}
	// SDK 对个人账户确认时会重新解析所属团队，身份变化必须先核查。
	if team == "" {
		profile, e := wallet.Client.GetUserByID(ctx, user)
		if e != nil {
			return e
		}
		if profile.Team != nil && profile.Team.Slug != "" {
			return fail(409, "wallet_identity_changed", "钱包归属已改变，需核查原交易")
		}
	}
	_, err = sqlc.New(conn).MarkWalletConfirming(ctx, sqlc.MarkWalletConfirmingParams{TransactionID: id, ActualAmountQuota: new(quotaAmount(amount, false))})
	if err != nil {
		return err
	}
	err = wallet.Client.ConfirmBillingCharge(ctx, &opensdk.ConfirmBillingChargeReq{BizID: biz, UserID: user, TeamSlug: team, Status: "success", ActualAmountCreditCents: quotaAmount(amount, false), Subject: item})
	if err != nil {
		code, trace := walletFailure(err)
		_, _ = sqlc.New(conn).SetWalletError(ctx, sqlc.SetWalletErrorParams{TransactionID: id, ErrorCode: code, TraceID: trace})
		_, _ = sqlc.New(conn).SetTransactionError(ctx, sqlc.SetTransactionErrorParams{ID: id, ErrorCode: code})
		return fail(503, code, "百智云确认待重试")
	}
	_, err = sqlc.New(conn).MarkWalletConfirmed(ctx, id)
	return err
}
func (s *Service) BindWallet(ctx context.Context, actor, user, external string) error {
	wallet, err := s.wallet(ctx, s.pool)
	if err != nil {
		return err
	}
	if !wallet.ready() {
		return fail(503, "wallet_unavailable", "未配置百智云计费连接")
	}
	if external == "" || len(external) > 128 {
		return resource.Invalid("百智云用户 ID 无效")
	}
	ok, err := sqlc.New(s.pool).HasWalletIdentity(ctx, sqlc.HasWalletIdentityParams{UserID: user, ProviderSubject: external})
	if err != nil {
		return err
	}
	if !ok {
		return fail(403, "baizhiyun_identity_required", "只能绑定用户通过百智云登录的身份")
	}
	c, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	profile, err := wallet.Client.GetUserByID(c, external)
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
	_, err = sqlc.New(tx).LockUser(ctx, user)
	if err != nil {
		return err
	}

	var pending bool
	pending, err = sqlc.New(tx).HasPendingWalletTransactions(ctx, user)
	if err != nil {
		return err
	}

	if pending {
		return fail(409, "wallet_transactions_pending", "用户有未完成的远程交易，暂不能变更绑定")
	}
	_, err = sqlc.New(tx).BindWalletUser(ctx, sqlc.BindWalletUserParams{UserID: user, ExternalUserID: external, UpdatedByUserID: actor})
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "bind_wallet", user, map[string]string{"external_user_id": external}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
