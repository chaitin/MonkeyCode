package imagegen

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

type memoryStorage struct{ data map[string][]byte }

func (s *memoryStorage) Put(_ context.Context, key string, body []byte, _ string) error {
	s.data[key] = bytes.Clone(body)
	return nil
}
func (s *memoryStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	body, ok := s.data[key]
	if !ok {
		return nil, errors.New("object missing")
	}
	return io.NopCloser(bytes.NewReader(body)), nil
}
func (s *memoryStorage) Delete(_ context.Context, key string) error { delete(s.data, key); return nil }
func (s *memoryStorage) Ping(context.Context) error                 { return nil }

func TestJobAndInputOwnership(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行生图任务数据库集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_image_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
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
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, pattern := range []string{"../../migrations/*.up.sql"} {
		paths, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range paths {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, string(data)); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
		}
	}
	userID, otherID, modelID := resource.ID(), resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'owner','owner@example.com','admin'),($2,'other','other@example.com','user')`, userID, otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO models(id,ownership_type,owner_user_id,model_id,display_name,protocol,kind,provider,base_url,api_key,advanced_config,image_config,image_pricing,credit_multiplier)
VALUES($1,'user',$2,'image-model','Image Model','image_generation','image','openai_images','https://example.com','test-key','{}','{}','{}',1)`, modelID, userID); err != nil {
		t.Fatal(err)
	}
	repo := NewPostgres(pool)
	job := Job{UserID: userID, ModelID: modelID, Provider: "openai_images", Operation: "generate", RequestedImages: 1,
		Quality: "1K", AspectRatio: "1:1", RequestHash: "hash-a", IdempotencyKey: "request-a"}
	created, isNew, err := repo.Create(ctx, job)
	if err != nil || !isNew || created.ID == "" {
		t.Fatalf("插入任务失败: %+v, %v, %v", created, isNew, err)
	}
	duplicate, isNew, err := repo.Create(ctx, job)
	if err != nil || isNew || duplicate.ID != created.ID {
		t.Fatalf("幂等任务不一致: %+v, %v, %v", duplicate, isNew, err)
	}
	job.RequestHash = "hash-b"
	if _, _, err := repo.Create(ctx, job); err == nil {
		t.Fatal("重复幂等键更改请求未拒绝")
	}
	if _, err := repo.Get(ctx, otherID, created.ID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("跨用户任务查询未阻止: %v", err)
	}
	freeJob := job
	freeJob.RequestHash, freeJob.IdempotencyKey = "hash-free", "request-free"
	freeJob, _, err = repo.Create(ctx, freeJob)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Reserve(ctx, freeJob, ""); err != nil {
		t.Fatal(err)
	}
	freeJob, err = repo.Get(ctx, userID, freeJob.ID)
	if err != nil || freeJob.Status != "reserved" || freeJob.BillingTransactionID != nil {
		t.Fatalf("自配生图任务应无计费交易: %+v, %v", freeJob, err)
	}

	var imageBytes bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 3))
	img.Set(0, 0, color.RGBA{R: 200, A: 255})
	if err := png.Encode(&imageBytes, img); err != nil {
		t.Fatal(err)
	}
	storage := &memoryStorage{data: map[string][]byte{}}
	inputs := NewInputs(repo, storage)
	file, err := inputs.Upload(ctx, userID, imageBytes.Bytes())
	if err != nil || file.Width != 2 || file.Height != 3 {
		t.Fatalf("上传参考图失败: %+v, %v", file, err)
	}
	got, err := inputs.Read(ctx, userID, file.ID)
	if err != nil || !bytes.Equal(got.Data, imageBytes.Bytes()) {
		t.Fatalf("读取参考图失败: %+v, %v", got, err)
	}
	if _, err := inputs.Read(ctx, otherID, file.ID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("跨用户参考图查询未阻止: %v", err)
	}
	if err := repo.LinkInputs(ctx, created.ID, []string{file.ID}); err != nil {
		t.Fatalf("任务参考图关联失败: %v", err)
	}
	if err := repo.LinkInputs(ctx, created.ID, []string{file.ID}); err == nil {
		t.Fatal("重复参考图关联未拒绝")
	}
	if _, err := pool.Exec(ctx, `UPDATE image_inputs SET expires_at = now() - interval '1 second' WHERE id = $1`, file.ID); err != nil {
		t.Fatal(err)
	}
	if count, err := inputs.Cleanup(ctx, 10); err != nil || count != 0 {
		t.Fatalf("进行中的任务参考图被清理: %d, %v", count, err)
	}
	if len(storage.data) != 1 {
		t.Fatalf("进行中任务参考图内容丢失: %d", len(storage.data))
	}
	if _, err := pool.Exec(ctx, `UPDATE image_jobs SET status = 'failed' WHERE id = $1`, created.ID); err != nil {
		t.Fatal(err)
	}
	if count, err := inputs.Cleanup(ctx, 10); err != nil || count != 1 || len(storage.data) != 0 {
		t.Fatalf("过期参考图未清理: %d, %v, %d", count, err, len(storage.data))
	}
	outputID := resource.ID()
	storage.data["image-outputs/result.png"] = imageBytes.Bytes()
	if _, err := pool.Exec(ctx, `INSERT INTO image_outputs(id,job_id,ordinal,object_key,mime_type,width,height,byte_size,sha256,expires_at)
VALUES($1,$2,0,'image-outputs/result.png','image/png',2,3,$3,'hash',now() - interval '1 second')`, outputID, created.ID, imageBytes.Len()); err != nil {
		t.Fatal(err)
	}
	if count, err := inputs.Cleanup(ctx, 10); err != nil || count != 1 || len(storage.data) != 0 {
		t.Fatalf("过期结果未清理: %d, %v, %d", count, err, len(storage.data))
	}
	var purged bool
	if err := pool.QueryRow(ctx, `SELECT purged_at IS NOT NULL FROM image_outputs WHERE id=$1`, outputID).Scan(&purged); err != nil || !purged {
		t.Fatalf("结果元数据未保留清理状态: %v, %v", purged, err)
	}

	charges := billing.NewService(pool)
	if err := charges.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE settings SET value=jsonb_set(value,'{enabled}','true'::jsonb) WHERE key='billing'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE models SET ownership_type='system', image_config='{"qualities":["1K"],"aspect_ratios":["1:1"],"default_quality":"1K","default_aspect_ratio":"1:1"}', image_pricing='{"base_credits_per_image":"7"}' WHERE id=$1`, modelID); err != nil {
		t.Fatal(err)
	}
	service := NewService(model.NewPostgres(pool), repo, inputs, NewOutputs(repo, storage), charges).
		WithAdapter(model.ProviderOpenAIImages, Adapter{
			Capabilities: func(string) (Capabilities, error) {
				return Capabilities{Operations: []string{"generate"}, Qualities: []string{"1K"}, AspectRatios: []string{"1:1"}, MaxCount: 1}, nil
			},
			Generator: generatorFunc(func(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error) {
				return ProviderResult{Status: "succeeded", Images: []Image{{Data: imageBytes.Bytes()}}}, nil
			}),
		})
	accepted, err := service.Generate(ctx, proxy.Target{ModelID: modelID, UserID: userID, UpstreamModel: "image-model"}, imageproxy.GenerateRequest{
		Model: "image-model@" + modelID, Prompt: "一只猫",
	})
	if err != nil || accepted.ID == "" {
		t.Fatalf("生图任务未受理: %+v, %v", accepted, err)
	}
	if err := service.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	completed, err := service.Get(ctx, userID, accepted.ID)
	if err != nil || completed.Status != "succeeded" || completed.Usage.Credits != "7" || len(completed.Outputs) != 1 {
		t.Fatalf("端到端积分或图片归档错误: %+v, %v", completed, err)
	}
	stored, mime, err := service.outputs.(*Outputs).Open(ctx, userID, strings.TrimPrefix(completed.Outputs[0].URL, "/v1/images/outputs/"))
	if err != nil || mime != "image/png" || !bytes.Equal(stored, imageBytes.Bytes()) {
		t.Fatalf("生图结果无法下载: %s, %v", mime, err)
	}
}
