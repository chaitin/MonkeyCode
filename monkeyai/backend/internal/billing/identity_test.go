package billing

import (
	"errors"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

func addWalletIdentity(t *testing.T, s *Service, user, subject string) {
	t.Helper()
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO user_identities(user_id,provider,issuer,provider_subject) VALUES($1,'baizhiyun','https://identity.example',$2)`, user, subject); err != nil {
		t.Fatal(err)
	}
}

func TestWalletRequiresBaizhiyunIdentity(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	wallet := &walletStub{}
	s.WithWallet(&Wallet{Client: wallet, BaseURL: "https://baizhiyun.vip", AppID: 4})
	p := defaultPolicy()
	p.Mode = "remote"
	setPolicy(t, s, p)
	if err := s.BindWallet(ctx, user, user, "1001"); err == nil {
		t.Fatal("普通用户不应绑定百智云钱包")
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO wallet_user_bindings(user_id,external_user_id,verified_at,updated_by_user_id) VALUES($1,'1001',now(),$1)`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO user_identities(user_id,provider,issuer,provider_subject) VALUES($1,'oidc','https://identity.example','1001')`, user); err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{false, true} {
		p.Enabled = enabled
		setPolicy(t, s, p)
		_, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
		var denied *resource.Error
		if !errors.As(err, &denied) || denied.Code != "baizhiyun_identity_required" {
			t.Fatalf("普通 OIDC 用户访问系统模型应被拒绝: %v", err)
		}
	}
	if _, err := sqlc.New(s.pool).WalletUser(ctx, user); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("历史绑定不得代替百智云身份: %v", err)
	}
	if len(wallet.creates) != 0 {
		t.Fatal("身份校验前调用了钱包")
	}
	addWalletIdentity(t, s, user, "1001")
	if err := s.BindWallet(ctx, user, user, "other"); err == nil {
		t.Fatal("不应绑定其他百智云用户")
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM wallet_user_bindings WHERE user_id=$1`, user); err != nil {
		t.Fatal(err)
	}
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil || r.ID == "" || len(wallet.creates) != 1 {
		t.Fatalf("百智云身份应自动用于扣费: %v", err)
	}
	var external string
	if err := s.pool.QueryRow(ctx, `SELECT external_user_id FROM wallet_billing_records WHERE transaction_id=$1`, r.ID).Scan(&external); err != nil || external != "1001" {
		t.Fatalf("扣费主体错误: %s %v", external, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE user_identities SET deleted_at=now() WHERE user_id=$1 AND provider='baizhiyun'`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"}); err == nil || len(wallet.creates) != 1 {
		t.Fatalf("失效百智云身份不得继续扣费: %v", err)
	}
}

func TestWalletIdentitySelection(t *testing.T) {
	s, user, _ := fixture(t)
	s.WithWallet(&Wallet{Client: &walletStub{}, BaseURL: "https://baizhiyun.vip", AppID: 4})
	addWalletIdentity(t, s, user, "1001")
	addWalletIdentity(t, s, user, "1002")
	if _, err := sqlc.New(s.pool).WalletUser(t.Context(), user); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("多个百智云身份不能任意选取: %v", err)
	}
	if err := s.BindWallet(t.Context(), user, user, "1002"); err != nil {
		t.Fatal(err)
	}
	subject, err := sqlc.New(s.pool).WalletUser(t.Context(), user)
	if err != nil || subject != "1002" {
		t.Fatalf("未使用核实后的绑定身份: %s %v", subject, err)
	}
}
