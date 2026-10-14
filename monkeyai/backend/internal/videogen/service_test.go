package videogen

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pollService(t *testing.T, pool *pgxpool.Pool) (*Service, string, string) {
	t.Helper()
	ctx := t.Context()
	userID, modelID := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'视频轮询测试',$2,'admin')`, userID, userID+"@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO models(id,ownership_type,owner_user_id,model_id,display_name,protocol,kind,provider,base_url,api_key,advanced_config,credit_multiplier,video_config,video_pricing)
VALUES($1,'system',$2,'MiniMax-H3','视频轮询测试','video_generation','video','minimax','https://provider.example','test-key','{}',1,'{}','{}')`, modelID, userID); err != nil {
		t.Fatal(err)
	}
	bills := billing.NewService(pool)
	if err := bills.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	rate, err := billing.ParseAmount("10")
	if err != nil {
		t.Fatal(err)
	}
	reservation, err := bills.Begin(ctx, billing.Request{UserID: userID, ResourceID: modelID, Category: "video", VideoUnitPrice: rate, VideoMaxDurationMs: 15000})
	if err != nil {
		t.Fatal(err)
	}
	if err := bills.Start(ctx, reservation.ID); err != nil {
		t.Fatal(err)
	}
	jobID := resource.ID()
	request, _ := json.Marshal(GenerateInput{Model: "MiniMax-H3@" + modelID})
	price, _ := json.Marshal(pricingSnapshot{Resolution: "768P"})
	if _, err := pool.Exec(ctx, `INSERT INTO video_jobs(id,user_id,model_id,provider,mode,status,request_hash,request_config,pricing_snapshot,provider_job_id,billing_transaction_id)
VALUES($1::uuid,$2,$3,'minimax','text_to_video','submitted','test',$4,$5,$1::uuid::text,$6)`, jobID, userID, modelID, request, price, reservation.ID); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, videoStorage{}, bills, model.NewPostgres(pool)), jobID, reservation.ID
}

func pollNow(t *testing.T, pool *pgxpool.Pool, jobID string) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `UPDATE video_jobs SET poll_after=now() WHERE id=$1`, jobID); err != nil {
		t.Fatal(err)
	}
}

func assertStoppedPoll(t *testing.T, pool *pgxpool.Pool, jobID, transactionID, reason string) {
	t.Helper()
	var jobStatus, jobCode, billingStatus, billingCode string
	var known bool
	if err := pool.QueryRow(t.Context(), `SELECT j.status,j.error_code,b.status,b.error_code,(b.usage->>'known')::boolean
FROM video_jobs j JOIN billing_transactions b ON b.id=j.billing_transaction_id WHERE j.id=$1 AND b.id=$2`, jobID, transactionID).
		Scan(&jobStatus, &jobCode, &billingStatus, &billingCode, &known); err != nil {
		t.Fatal(err)
	}
	if jobStatus != "unknown" || billingStatus != "unknown" || jobCode != reason || billingCode != reason || known {
		t.Fatalf("应停止轮询并保留待核查计费: job=%s/%s billing=%s/%s known=%v", jobStatus, jobCode, billingStatus, billingCode, known)
	}
}

func TestVideoPollRetryLimit(t *testing.T) {
	pool := videoPool(t)
	for _, status := range []int{http.StatusNotFound, http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			service, jobID, transactionID := pollService(t, pool)
			calls := 0
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
			})}
			for attempt := 1; attempt <= 10; attempt++ {
				// 每轮重建服务，验证重启不会重置连续失败计数。
				service = NewService(pool, service.storage, service.billing, service.models)
				service.client = client
				pollNow(t, pool, jobID)
				if err := service.poll(t.Context()); err != nil {
					t.Fatal(err)
				}
				var failures int
				var retryAt time.Time
				if err := pool.QueryRow(t.Context(), `SELECT poll_failures,poll_after FROM video_jobs WHERE id=$1`, jobID).Scan(&failures, &retryAt); err != nil {
					t.Fatal(err)
				}
				if failures != attempt || calls != attempt {
					t.Fatalf("失败次数未持久化: attempt=%d failures=%d calls=%d", attempt, failures, calls)
				}
				if attempt < 10 {
					wantDelay := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute, 5 * time.Minute}[min(attempt-1, 4)]
					if delay := time.Until(retryAt); delay > wantDelay || delay < wantDelay-time.Second {
						t.Fatalf("重试退避错误: attempt=%d delay=%s want=%s", attempt, delay, wantDelay)
					}
					if err := service.poll(t.Context()); err != nil {
						t.Fatal(err)
					}
					if calls != attempt {
						t.Fatalf("等待退避期间不应查询供应商: calls=%d attempt=%d", calls, attempt)
					}
				}
			}
			assertStoppedPoll(t, pool, jobID, transactionID, "provider_poll_exhausted")
			pollNow(t, pool, jobID)
			if err := service.poll(t.Context()); err != nil {
				t.Fatal(err)
			}
			if calls != 10 {
				t.Fatalf("超出上限后仍查询供应商: calls=%d", calls)
			}
		})
	}
}

func TestVideoPollSuccessResetsFailures(t *testing.T) {
	pool := videoPool(t)
	service, jobID, _ := pollService(t, pool)
	for index, status := range []int{http.StatusBadGateway, http.StatusOK, http.StatusBadGateway} {
		service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{"task":{"status":"running"}}`))}, nil
		})}
		pollNow(t, pool, jobID)
		if err := service.poll(t.Context()); err != nil {
			t.Fatal(err)
		}
		var failures int
		if err := pool.QueryRow(t.Context(), `SELECT poll_failures FROM video_jobs WHERE id=$1`, jobID).Scan(&failures); err != nil {
			t.Fatal(err)
		}
		if want := []int{1, 0, 1}[index]; failures != want {
			t.Fatalf("成功查询未重置连续失败次数: step=%d failures=%d want=%d", index, failures, want)
		}
	}
}

func TestVideoPollStopsBeforeQuery(t *testing.T) {
	pool := videoPool(t)
	for _, tc := range []struct {
		name     string
		age      time.Duration
		failures int
		reason   string
	}{
		{"正常轮询也有总超时", 31 * time.Minute, 0, "provider_poll_timeout"},
		{"历史遗留任务", 24 * time.Hour, 0, "provider_poll_timeout"},
		{"达到失败上限后重启", time.Minute, 10, "provider_poll_exhausted"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, jobID, transactionID := pollService(t, pool)
			if _, err := pool.Exec(t.Context(), `UPDATE video_jobs SET created_at=$2,poll_failures=$3 WHERE id=$1`, jobID, time.Now().Add(-tc.age), tc.failures); err != nil {
				t.Fatal(err)
			}
			service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				t.Error("达到停止条件后不应再查询供应商")
				return nil, errors.New("不应发出请求")
			})}
			if err := service.poll(t.Context()); err != nil {
				t.Fatal(err)
			}
			assertStoppedPoll(t, pool, jobID, transactionID, tc.reason)
		})
	}
}

func TestVideoPollDeadline(t *testing.T) {
	pool := videoPool(t)
	for _, tc := range []struct {
		name string
		wait bool
	}{
		{"重试时间不超过总期限", false},
		{"请求受总期限约束", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, jobID, transactionID := pollService(t, pool)
			remaining := 15 * time.Second
			if tc.wait {
				remaining = time.Second
			}
			var createdAt time.Time
			if err := pool.QueryRow(t.Context(), `UPDATE video_jobs SET created_at=$2 WHERE id=$1 RETURNING created_at`, jobID, time.Now().Add(-30*time.Minute+remaining)).Scan(&createdAt); err != nil {
				t.Fatal(err)
			}
			service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				deadline, ok := r.Context().Deadline()
				if !ok || !deadline.Equal(createdAt.Add(30*time.Minute)) {
					t.Fatalf("供应商请求未使用任务总期限: deadline=%s", deadline)
				}
				if tc.wait {
					<-r.Context().Done()
					return nil, r.Context().Err()
				}
				return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
			})}
			if err := service.poll(t.Context()); err != nil {
				t.Fatal(err)
			}
			if tc.wait {
				assertStoppedPoll(t, pool, jobID, transactionID, "provider_poll_timeout")
				return
			}
			var retryAt time.Time
			if err := pool.QueryRow(t.Context(), `SELECT poll_after FROM video_jobs WHERE id=$1`, jobID).Scan(&retryAt); err != nil {
				t.Fatal(err)
			}
			if !retryAt.Equal(createdAt.Add(30 * time.Minute)) {
				t.Fatalf("退避不应超过任务总期限: retry_at=%s", retryAt)
			}
		})
	}
}

func TestVideoPollCancellationDoesNotCount(t *testing.T) {
	pool := videoPool(t)
	service, jobID, transactionID := pollService(t, pool)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		cancel()
		return nil, r.Context().Err()
	})}
	if err := service.poll(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("应返回服务关闭导致的取消: %v", err)
	}
	var failures int
	var jobStatus, billingStatus string
	if err := pool.QueryRow(t.Context(), `SELECT j.poll_failures,j.status,b.status FROM video_jobs j JOIN billing_transactions b ON b.id=j.billing_transaction_id WHERE j.id=$1 AND b.id=$2`, jobID, transactionID).
		Scan(&failures, &jobStatus, &billingStatus); err != nil {
		t.Fatal(err)
	}
	if failures != 0 || jobStatus != "submitted" || billingStatus != "running" {
		t.Fatalf("关闭服务不应增加失败或终止任务: failures=%d job=%s billing=%s", failures, jobStatus, billingStatus)
	}
}

func TestVideoPollProviderFailureReleasesBilling(t *testing.T) {
	pool := videoPool(t)
	service, jobID, transactionID := pollService(t, pool)
	service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"task":{"status":"failed"}}`))}, nil
	})}
	if err := service.poll(t.Context()); err != nil {
		t.Fatal(err)
	}
	var jobStatus, billingStatus string
	if err := pool.QueryRow(t.Context(), `SELECT j.status,b.status FROM video_jobs j JOIN billing_transactions b ON b.id=j.billing_transaction_id WHERE j.id=$1 AND b.id=$2`, jobID, transactionID).
		Scan(&jobStatus, &billingStatus); err != nil {
		t.Fatal(err)
	}
	if jobStatus != "failed" || billingStatus != "released" {
		t.Fatalf("供应商明确失败应正常释放计费: job=%s billing=%s", jobStatus, billingStatus)
	}
}
