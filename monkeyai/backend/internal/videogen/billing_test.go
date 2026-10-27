package videogen

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestVideoBillingUsesProviderDuration(t *testing.T) {
	pool := videoPool(t)
	for _, recovered := range []bool{false, true} {
		name := "新任务"
		if recovered {
			name = "恢复已归档的超额任务"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			service, jobID, transactionID := pollService(t, pool)
			var userID, modelID string
			if err := pool.QueryRow(ctx, `SELECT user_id,model_id FROM video_jobs WHERE id=$1`, jobID).Scan(&userID, &modelID); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `UPDATE models SET model_id='grok-imagine-video-1.5',provider='xai' WHERE id=$1`, modelID); err != nil {
				t.Fatal(err)
			}
			mvhd, tkhd := make([]byte, 32), make([]byte, 84)
			binary.BigEndian.PutUint32(mvhd[12:16], 1000)
			binary.BigEndian.PutUint32(mvhd[16:20], 15042)
			binary.BigEndian.PutUint32(tkhd[76:80], 1280<<16)
			binary.BigEndian.PutUint32(tkhd[80:84], 720<<16)
			data := append(mp4Box("ftyp", []byte("isom")), mp4Box("moov", append(mp4Box("mvhd", mvhd), mp4Box("trak", mp4Box("tkhd", tkhd))...))...)
			downloads := 0
			service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "provider.example" {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"done","video":{"url":"https://media.example/video.mp4","duration":15}}`))}, nil
				}
				downloads++
				return &http.Response{StatusCode: 200, ContentLength: int64(len(data)), Body: io.NopCloser(bytes.NewReader(data))}, nil
			})}
			if recovered {
				if _, err := service.saveOutput(ctx, service.client, jobID, "https://media.example/video.mp4", 15000); err != nil {
					t.Fatal(err)
				}
				if err := service.billing.Finish(ctx, transactionID, billing.Usage{Result: "succeeded", Known: true, VideoDurationMs: 15042}); err != nil {
					t.Fatal(err)
				}
				_, err := service.billing.VideoCharge(ctx, transactionID, userID)
				charge, ok := errors.AsType[*billing.VideoChargeError](err)
				if !ok || charge.Status != "unknown" || charge.Code != "reservation_exceeded" {
					t.Fatalf("未复现旧任务超额状态: %v", err)
				}
			}
			if err := service.poll(ctx); err != nil {
				t.Fatal(err)
			}
			task, err := service.GetTask(ctx, userID, jobID)
			if err != nil || task.Status != "succeeded" || task.Output == nil || task.Usage == nil {
				t.Fatalf("任务未交付: %+v %v", task, err)
			}
			if task.Output.DurationMs != 15042 || task.Usage.OutputDurationMs != 15000 || task.Usage.Credits != "150" {
				t.Fatalf("文件时长与计费时长未分开: output=%+v usage=%+v", task.Output, task.Usage)
			}
			// 模拟标记成功前的重试，不能重复下载或扣费。
			if err := service.process(ctx, jobID, modelID, jobID, transactionID, userID); err != nil {
				t.Fatal(err)
			}
			var status, code, amount string
			var usage billing.Usage
			var raw []byte
			if err := pool.QueryRow(ctx, `SELECT status,error_code,amount::text,usage FROM billing_transactions WHERE id=$1`, transactionID).Scan(&status, &code, &amount, &raw); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &usage); err != nil {
				t.Fatal(err)
			}
			if status != "settled" || code != "" || amount != "150.000000" || usage.VideoDurationMs != 15000 || !usage.Known || usage.Result != "succeeded" || downloads != 1 {
				t.Fatalf("结算或恢复错误: %s %s %s %+v downloads=%d", status, code, amount, usage, downloads)
			}
			var charges int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE transaction_id=$1 AND entry_type='charge'`, transactionID).Scan(&charges); err != nil {
				t.Fatal(err)
			}
			if charges != 1 {
				t.Fatalf("重复扣费: %d", charges)
			}
		})
	}
}

func TestVideoBillingUnknownStopsPoll(t *testing.T) {
	pool := videoPool(t)
	ctx := t.Context()
	service, jobID, transactionID := pollService(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE billing_transactions SET reserve=50 WHERE id=$1`, transactionID); err != nil {
		t.Fatal(err)
	}
	service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := "mp4"
		if r.URL.Host == "provider.example" {
			body = `{"task":{"status":"succeeded","content":{"url":"https://media.example/video.mp4"},"duration":6}}`
		}
		return &http.Response{StatusCode: 200, ContentLength: int64(len(body)), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(logging.New(&logs, slog.LevelWarn))
	t.Cleanup(func() { slog.SetDefault(previous) })
	if err := service.poll(ctx); err != nil {
		t.Fatal(err)
	}
	var userID, status, code string
	var known bool
	if err := pool.QueryRow(ctx, `SELECT j.user_id,j.status,j.error_code,(b.usage->>'known')::boolean FROM video_jobs j JOIN billing_transactions b ON b.id=j.billing_transaction_id WHERE j.id=$1`, jobID).Scan(&userID, &status, &code, &known); err != nil {
		t.Fatal(err)
	}
	if status != "unknown" || code != "reservation_exceeded" || !known {
		t.Fatalf("待核查原因或已知用量丢失: %s %s %v", status, code, known)
	}
	task, err := service.GetTask(ctx, userID, jobID)
	if err != nil || task.Status != "unknown" || task.ErrorCode != code {
		t.Fatalf("前端状态错误: %+v %v", task, err)
	}
	if !strings.Contains(logs.String(), `"error_code":"reservation_exceeded"`) || !strings.Contains(logs.String(), "status=unknown error_code=reservation_exceeded") {
		t.Fatalf("未保留计费诊断: %s", logs.String())
	}
}
