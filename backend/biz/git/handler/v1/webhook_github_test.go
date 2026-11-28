package v1

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/GoYoko/web"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type webhookBotStub struct {
	domain.GitBotUsecase
	bot *domain.GitBot
}

func (s webhookBotStub) GetByID(context.Context, uuid.UUID) (*domain.GitBot, error) {
	return s.bot, nil
}

type webhookHostStub struct{ fail bool }

func (s *webhookHostStub) PickHost(context.Context) (*domain.Host, error) {
	if s.fail {
		return nil, errors.New("host unavailable")
	}
	return &domain.Host{}, nil
}

type webhookTaskStub struct {
	domain.GitTaskUsecase
	create func(context.Context, domain.CreateGitTaskReq) (*domain.GitTask, error)
}

func (s webhookTaskStub) Create(ctx context.Context, req domain.CreateGitTaskReq) (*domain.GitTask, error) {
	return s.create(ctx, req)
}

func githubWebhookFixture(t *testing.T) (*GithubWebhookHandler, *miniredis.Miniredis, func(context.Context, string) int) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1})
	t.Cleanup(func() { rdb.Close() })
	bot := &domain.GitBot{ID: uuid.New()}
	cfg := &config.Config{}
	cfg.Task.ImageID = uuid.NewString()
	h := &GithubWebhookHandler{cfg: cfg, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), redis: rdb, pubhost: &webhookHostStub{}, gitbotUsecase: webhookBotStub{bot: bot}}
	request := func(ctx context.Context, delivery string) int {
		payload := `{"action":"synchronize","pull_request":{"id":1,"number":1,"html_url":"https://github.com/test/repo/pull/1","head":{"ref":"feature","repo":{"id":1,"html_url":"https://github.com/test/repo"}},"user":{"login":"test"}}}`
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(payload)).WithContext(ctx)
		req.Header.Set("X-GitHub-Event", "pull_request")
		req.Header.Set("X-GitHub-Delivery", delivery)
		rec := httptest.NewRecorder()
		c := echo.New().NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues(bot.ID.String())
		if err := h.Webhook(&web.Context{Context: c}); err != nil {
			t.Fatal(err)
		}
		return rec.Code
	}
	return h, mr, request
}

func TestGithubWebhookDeliveryDeduplication(t *testing.T) {
	h, _, request := githubWebhookFixture(t)
	calls := 0
	h.gitTaskUsecase = webhookTaskStub{create: func(context.Context, domain.CreateGitTaskReq) (*domain.GitTask, error) {
		calls++
		return &domain.GitTask{}, nil
	}}
	for _, id := range []string{"delivery-1", "delivery-1", "delivery-2"} {
		if status := request(context.Background(), id); status != 200 {
			t.Fatalf("status=%d", status)
		}
	}
	if calls != 2 {
		t.Fatalf("created %d tasks, want one per delivery", calls)
	}
}

func TestGithubWebhookFailedDeliveryCanBeRetried(t *testing.T) {
	for _, failure := range []string{"host", "create", "cancelled"} {
		t.Run(failure, func(t *testing.T) {
			h, _, request := githubWebhookFixture(t)
			host := h.pubhost.(*webhookHostStub)
			host.fail = failure == "host"
			calls := 0
			fail := true
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			h.gitTaskUsecase = webhookTaskStub{create: func(context.Context, domain.CreateGitTaskReq) (*domain.GitTask, error) {
				calls++
				if fail {
					if failure == "cancelled" {
						cancel()
					}
					return nil, errors.New("creation failed")
				}
				return &domain.GitTask{}, nil
			}}
			if status := request(ctx, "retry"); status != 500 {
				t.Fatalf("failure status=%d, want 500", status)
			}
			fail = false
			host.fail = false
			if status := request(context.Background(), "retry"); status != 200 {
				t.Fatalf("retry status=%d", status)
			}
			want := 2
			if failure == "host" {
				want = 1
			}
			if calls != want {
				t.Fatalf("create calls=%d, want %d", calls, want)
			}
		})
	}
}

func TestGithubWebhookFailedOwnerDoesNotReleaseNewClaim(t *testing.T) {
	h, mr, request := githubWebhookFixture(t)
	key := "github:pr_review:" + h.gitbotUsecase.(webhookBotStub).bot.ID.String() + ":expired"
	h.gitTaskUsecase = webhookTaskStub{create: func(ctx context.Context, _ domain.CreateGitTaskReq) (*domain.GitTask, error) {
		mr.FastForward(6 * time.Minute)
		if err := h.redis.Set(ctx, key, "new-owner", 5*time.Minute).Err(); err != nil {
			t.Fatal(err)
		}
		return nil, errors.New("old creation failed")
	}}
	if status := request(context.Background(), "expired"); status != 500 {
		t.Fatalf("status=%d", status)
	}
	if got, err := mr.Get(key); err != nil || got != "new-owner" {
		t.Fatalf("new claim removed: %q, %v", got, err)
	}
}

func TestGithubWebhookRedisFailureIsNotAcknowledged(t *testing.T) {
	h, mr, request := githubWebhookFixture(t)
	h.gitTaskUsecase = webhookTaskStub{create: func(context.Context, domain.CreateGitTaskReq) (*domain.GitTask, error) {
		t.Fatal("task created without deduplication")
		return nil, nil
	}}
	mr.SetError("unavailable")
	if status := request(context.Background(), "redis-failure"); status != 500 {
		t.Fatalf("status=%d, want 500", status)
	}
}

func TestGithubWebhookConcurrentDuplicate(t *testing.T) {
	h, _, request := githubWebhookFixture(t)
	started, finish := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	h.gitTaskUsecase = webhookTaskStub{create: func(context.Context, domain.CreateGitTaskReq) (*domain.GitTask, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-finish
		return &domain.GitTask{}, nil
	}}
	done := make(chan int, 1)
	go func() { done <- request(context.Background(), "concurrent") }()
	<-started
	duplicateStatus := request(context.Background(), "concurrent")
	close(finish)
	originalStatus := <-done
	if duplicateStatus != 200 || originalStatus != 200 || calls.Load() != 1 {
		t.Fatalf("original=%d, duplicate=%d, calls=%d", originalStatus, duplicateStatus, calls.Load())
	}
}
