package videogen

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestSeedanceVideoLifecycle(t *testing.T) {
	pool := videoPool(t)
	ctx := t.Context()
	userID := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'视频测试','seedance@example.com','admin')`, userID); err != nil {
		t.Fatal(err)
	}
	repo := model.NewPostgres(pool)
	item, err := model.NewService(repo).Create(ctx, userID, model.SaveInput{
		ModelID: "doubao-seedance-2-5-260628", DisplayName: "Seedance 2.5", Kind: model.KindVideo, Protocol: model.ProtocolVideo, Provider: model.ProviderVolcengine,
		BaseURL: "https://ark.example/api/v3", APIKey: "secret", Authorization: model.Authorization{UserIDs: []string{userID}},
		VideoConfig: &model.VideoConfig{Modes: []model.VideoMode{model.VideoTextToVideo}, Defaults: map[model.VideoMode]map[string]json.RawMessage{
			model.VideoTextToVideo: seedanceInput().Params,
		}},
		VideoPricing: &model.VideoPricing{Rates: []model.VideoResolutionRate{
			{Resolution: "480p", CreditsPerSecond: "10"}, {Resolution: "720p", CreditsPerSecond: "10"}, {Resolution: "1080p", CreditsPerSecond: "10"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	modelID := item.ID
	bills := billing.NewService(pool)
	if err := bills.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	mvhd, tkhd := make([]byte, 32), make([]byte, 84)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 30000)
	binary.BigEndian.PutUint32(tkhd[76:80], 1280<<16)
	binary.BigEndian.PutUint32(tkhd[80:84], 720<<16)
	data := append(mp4Box("ftyp", []byte("isom")), mp4Box("moov", append(mp4Box("mvhd", mvhd), mp4Box("trak", mp4Box("tkhd", tkhd))...))...)
	storage := videoStorage{}
	service := NewService(pool, storage, bills, repo)
	submissions := 0
	service.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"id":"cgt-123"}`
		if r.Method == http.MethodPost {
			submissions++
		} else if r.URL.Host == "ark.example" {
			body = `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":30}`
		} else {
			return &http.Response{StatusCode: 200, ContentLength: int64(len(data)), Body: io.NopCloser(bytes.NewReader(data))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	input := seedanceInput()
	input.Params["duration_seconds"] = json.RawMessage(`30`)
	target := proxy.Target{UserID: userID, ModelID: modelID, UpstreamModel: item.ModelID, Protocol: string(model.ProtocolVideo), BaseURL: item.BaseURL, APIKey: item.APIKey}
	task, err := service.Submit(ctx, target, input, "seedance-30s")
	if err != nil {
		t.Fatal(err)
	}
	wait, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := service.Wait(wait); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT pricing_snapshot FROM video_jobs WHERE id=$1`, task.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var price pricingSnapshot
	if err := json.Unmarshal(raw, &price); err != nil || price.MaxDurationMs != 30000 || price.ReservedCredits != "300" {
		t.Fatalf("30 秒积分预估错误: %+v, %v", price, err)
	}
	repeated, err := service.Submit(ctx, target, input, "seedance-30s")
	if err != nil || repeated.ID != task.ID || submissions != 1 {
		t.Fatalf("幂等任务重复提交: %+v, submissions=%d, %v", repeated, submissions, err)
	}
	if err := service.poll(ctx); err != nil {
		t.Fatal(err)
	}
	task, err = service.GetTask(ctx, userID, task.ID)
	if err != nil || task.Status != "succeeded" || task.Output == nil || task.Usage == nil {
		t.Fatalf("任务未完成: %+v, %v", task, err)
	}
	if task.Output.Width != 1280 || task.Output.Height != 720 || task.Output.DurationMs != 30000 || task.Usage.Credits != "300" {
		t.Fatalf("30 秒结果归档或结算错误: %+v, %+v", task.Output, task.Usage)
	}
	body, _, _, err := service.OpenOutput(ctx, userID, task.Output.FileID)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	got, err := io.ReadAll(body)
	if err != nil || !bytes.Equal(data, got) {
		t.Fatalf("30 秒视频下载错误: %v", err)
	}
}
