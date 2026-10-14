package videogen

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

type videoStorage map[string][]byte

func (s videoStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s[key] = bytes.Clone(data)
	return nil
}

func (s videoStorage) PutReader(ctx context.Context, key string, reader io.ReadSeeker, _ int64, mime string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	return s.Put(ctx, key, data, mime)
}

func (s videoStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	data, ok := s[key]
	if !ok {
		return nil, errors.New("视频结果不存在")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (s videoStorage) Delete(_ context.Context, key string) error { delete(s, key); return nil }
func (s videoStorage) Ping(context.Context) error                 { return nil }

func videoPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行视频结果数据库集成测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "video_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), string(data)); err != nil {
			t.Fatalf("迁移 %s: %v", path, err)
		}
	}
	return pool
}

func TestSucceededVideoDownload(t *testing.T) {
	pool := videoPool(t)
	ctx := t.Context()
	userID, modelID := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'视频测试','video@example.com','admin')`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO models(id,ownership_type,owner_user_id,model_id,display_name,protocol,kind,provider,base_url,api_key,advanced_config,credit_multiplier,video_config,video_pricing)
VALUES($1,'system',$2,'MiniMax-H3','视频测试','video_generation','video','minimax','https://provider.example','test-key','{}',1,'{}','{}')`, modelID, userID); err != nil {
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
	mvhd, tkhd := make([]byte, 32), make([]byte, 84)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 6584)
	binary.BigEndian.PutUint32(tkhd[76:80], 768<<16)
	binary.BigEndian.PutUint32(tkhd[80:84], 768<<16)
	mp4 := append(mp4Box("ftyp", []byte("isom")), mp4Box("moov", append(mp4Box("mvhd", mvhd), mp4Box("trak", mp4Box("tkhd", tkhd))...))...)
	for _, tc := range []struct {
		name        string
		data        []byte
		width       int
		duration    int64
		credits     string
		interrupted bool
	}{
		{"时长与上游不一致", mp4, 768, 6584, "65.84", true},
		{"元数据无法解析", []byte("provider video with unsupported metadata"), 0, 6000, "60", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reservation, err := bills.Begin(ctx, billing.Request{UserID: userID, ResourceID: modelID, Category: "video", VideoUnitPrice: rate, VideoMaxDurationMs: 15000})
			if err != nil {
				t.Fatal(err)
			}
			if err := bills.Start(ctx, reservation.ID); err != nil {
				t.Fatal(err)
			}
			if tc.interrupted {
				if _, err := pool.Exec(ctx, `UPDATE billing_transactions SET status='unknown',error_code='execution_interrupted' WHERE id=$1`, reservation.ID); err != nil {
					t.Fatal(err)
				}
			}
			jobID := resource.ID()
			request, _ := json.Marshal(GenerateInput{Model: "MiniMax-H3@" + modelID})
			price, _ := json.Marshal(pricingSnapshot{Resolution: "768P"})
			if _, err := pool.Exec(ctx, `INSERT INTO video_jobs(id,user_id,model_id,provider,mode,status,request_hash,request_config,pricing_snapshot,provider_job_id,billing_transaction_id)
VALUES($1::uuid,$2,$3,'minimax','text_to_video','running','test',$4,$5,$1::uuid::text,$6)`, jobID, userID, modelID, request, price, reservation.ID); err != nil {
				t.Fatal(err)
			}
			storage := videoStorage{}
			service := NewService(pool, storage, bills, model.NewPostgres(pool))
			service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "provider.example" {
					return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"task":{"status":"succeeded","content":{"url":"https://assets.example/video.mp4"},"duration":6}}`))}, nil
				}
				return &http.Response{StatusCode: http.StatusOK, ContentLength: int64(len(tc.data)), Body: io.NopCloser(bytes.NewReader(tc.data))}, nil
			})}
			if err := service.poll(ctx); err != nil {
				t.Fatal(err)
			}
			task, err := service.GetTask(ctx, userID, jobID)
			if err != nil || task.Status != "succeeded" || task.Output == nil || task.Usage == nil {
				t.Fatalf("上游成功的视频未完成保存和结算: %+v, %v", task, err)
			}
			if task.Output.Width != tc.width || task.Output.Height != tc.width || task.Output.DurationMs != tc.duration || task.Usage.Credits != tc.credits {
				t.Fatalf("视频元数据或积分错误: output=%+v usage=%+v", task.Output, task.Usage)
			}
			body, size, mime, err := service.OpenOutput(ctx, userID, task.Output.FileID)
			if err != nil {
				t.Fatalf("成功视频无法下载: %v", err)
			}
			defer body.Close()
			data, err := io.ReadAll(body)
			if err != nil || size != int64(len(tc.data)) || mime != "video/mp4" || !bytes.Equal(data, tc.data) {
				t.Fatalf("下载的视频内容不一致: size=%d mime=%s err=%v", size, mime, err)
			}
		})
	}
}
