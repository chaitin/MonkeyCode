package billing

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestImageReservationSettlementAndReconciliation(t *testing.T) {
	for _, tc := range []struct {
		name, result string
		known        bool
		images       int64
		charge       string
	}{
		{"部分成功按一张扣费", "succeeded", true, 1, "12.5"},
		{"审核拒绝不扣费", "failed", true, 0, "0"},
		{"未知先冻结后确认", "failed", false, 0, "0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, user, id := fixture(t)
			ctx := t.Context()
			if _, err := s.pool.Exec(ctx, `UPDATE models SET protocol='image_generation', kind='image', provider='openai_images', advanced_config='{}', image_config='{}', image_pricing='{}', credit_multiplier=1 WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
			before, err := s.Account(ctx, user)
			if err != nil {
				t.Fatal(err)
			}
			unit, err := ParseAmount("12.5")
			if err != nil {
				t.Fatal(err)
			}
			r, err := s.Begin(ctx, Request{UserID: user, ResourceID: id, Category: "image", ImageUnitPrice: unit, ImageCount: 2})
			if err != nil {
				t.Fatal(err)
			}
			reserved, err := s.Account(ctx, user)
			if err != nil || reserved.Frozen-before.Frozen != amountText("25") {
				t.Fatalf("必须预留两张费用: %+v -> %+v, %v", before, reserved, err)
			}
			if err := s.Start(ctx, r.ID); err != nil {
				t.Fatal(err)
			}
			usage := Usage{Known: tc.known, Result: tc.result, Images: tc.images}
			if err := s.Finish(ctx, r.ID, usage); err != nil {
				t.Fatal(err)
			}
			if !tc.known {
				unknown, err := s.Account(ctx, user)
				if err != nil || unknown.Frozen != reserved.Frozen {
					t.Fatalf("未知状态不可退款: %+v, %v", unknown, err)
				}
				if err := s.Finish(ctx, r.ID, Usage{Known: true, Result: "failed", ErrorCode: "content_rejected"}); err != nil {
					t.Fatal(err)
				}
			}
			amount, err := s.ImageCharge(ctx, r.ID, user)
			if err != nil || amount.String() != tc.charge {
				t.Fatalf("最终图片费用不符: %s, %v", amount, err)
			}
			after, err := s.Account(ctx, user)
			if err != nil || after.Frozen != before.Frozen || after.Balance != before.Balance-amount {
				t.Fatalf("积分未正确结算: %+v -> %+v, %v", before, after, err)
			}
			var count int64
			if err := s.pool.QueryRow(ctx, `SELECT generated_images FROM image_calls WHERE id=$1`, r.ID).Scan(&count); err != nil || count != tc.images {
				if !tc.known && count == 0 && err == nil {
					return
				}
				t.Fatalf("图片用量记录缺失: %d, %v", count, err)
			}
		})
	}
}

func TestImageManualReconciliationUpdatesJob(t *testing.T) {
	s, user, id := fixture(t)
	ctx := t.Context()
	if _, err := s.pool.Exec(ctx, `UPDATE models SET protocol='image_generation', kind='image', provider='openai_images', advanced_config='{}', image_config='{}', image_pricing='{}', credit_multiplier=1 WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: id, Category: "image", ImageUnitPrice: amountText("5"), ImageCount: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	jobID := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO image_jobs(id,user_id,model_id,billing_transaction_id,provider,operation,status,request_hash,requested_images,quality,aspect_ratio)
VALUES($1,$2,$3,$4,'openai_images','generate','unknown','hash',2,'1K','1:1')`, jobID, user, id, r.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(ctx, r.ID, Usage{Known: false, Result: "failed", ErrorCode: "status_unknown"}); err != nil {
		t.Fatal(err)
	}
	call := walletAdmin(t, s, user)
	path := "/billing/transactions/" + r.ID + "/resolve"
	call("POST", path, map[string]any{"reason": "已核对一张归档图片", "usage": map[string]any{"result": "succeeded", "generated_images": 1}}, 400)
	if _, err := s.pool.Exec(ctx, `INSERT INTO image_outputs(id,job_id,ordinal,object_key,mime_type,width,height,byte_size,sha256,expires_at)
VALUES($1,$2,0,'test-output.png','image/png',1,1,16,'hash',now()+interval '30 days')`, resource.ID(), jobID); err != nil {
		t.Fatal(err)
	}
	call("POST", path, map[string]any{"reason": "已核对一张归档图片", "usage": map[string]any{"result": "succeeded", "generated_images": 1}}, 200)
	amount, err := s.ImageCharge(ctx, r.ID, user)
	if err != nil || amount != amountText("5") {
		t.Fatalf("人工对账未按归档张数计费: %s, %v", amount, err)
	}
	var state string
	var count int32
	if err := s.pool.QueryRow(ctx, `SELECT status,generated_images FROM image_jobs WHERE id=$1`, jobID).Scan(&state, &count); err != nil || state != "succeeded" || count != 1 {
		t.Fatalf("生图任务与交易状态不一致: %s/%d, %v", state, count, err)
	}
}

func TestImageOwnedModelsFree(t *testing.T) {
	s, user, id := fixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `UPDATE models SET protocol='image_generation', kind='image', provider='openai_images', ownership_type='user', advanced_config='{}', image_config='{}', image_pricing='{}', credit_multiplier=1 WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	before, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: id, Category: "image", ImageUnitPrice: amountText("5"), ImageCount: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(ctx, r.ID, Usage{Known: true, Result: "succeeded", Images: 2}); err != nil {
		t.Fatal(err)
	}
	after, err := s.Account(ctx, user)
	if err != nil || after.Balance != before.Balance || after.Frozen != before.Frozen {
		t.Fatalf("用户自有生图模型不应扣积分: %+v -> %+v, %v", before, after, err)
	}
}
