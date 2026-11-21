package v1

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// GithubWebhookHandler GitHub Webhook 处理器
type GithubWebhookHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gitbotUsecase  domain.GitBotUsecase
	pubhost        domain.PublicHostUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewGithubWebhookHandler 创建 GitHub Webhook 处理器
func NewGithubWebhookHandler(i *do.Injector) (*GithubWebhookHandler, error) {
	h := &GithubWebhookHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "GithubWebhookHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gitbotUsecase:  do.MustInvoke[domain.GitBotUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
		pubhost:        do.MustInvoke[domain.PublicHostUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	w.Group("/api/v1").POST("/github/webhook/:id", web.BaseHandler(h.Webhook))

	return h, nil
}

// Webhook 处理 GitHub Webhook 请求
func (h *GithubWebhookHandler) Webhook(c *web.Context) error {
	ctx := c.Request().Context()
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}

	bot, err := h.gitbotUsecase.GetByID(ctx, id)
	if err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to get gitbot")
		return c.String(http.StatusNotFound, "bot not found")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return err
	}

	// 验证签名
	sig := c.Request().Header.Get("X-Hub-Signature-256")
	if err := validateHMACSHA256(bot.SecretToken, sig, body); err != nil {
		h.logger.With("error", err).WarnContext(ctx, "github webhook signature validation failed")
		return c.String(http.StatusUnauthorized, "invalid signature")
	}

	event := c.Request().Header.Get("X-Github-Event")
	h.logger.With("bot", bot.ID, "body", string(body), "event", event).DebugContext(c.Request().Context(), "github webhook")
	if event == "pull_request" {
		if err := h.handlePullRequest(ctx, bot, body, c.Request().Header.Get("X-GitHub-Delivery")); err != nil {
			h.logger.With("error", err).ErrorContext(ctx, "failed to handle github pr event")
			return c.String(http.StatusInternalServerError, "failed to create review task")
		}
	}

	return c.String(http.StatusOK, "ok")
}

func (h *GithubWebhookHandler) handlePullRequest(ctx context.Context, bot *domain.GitBot, payload []byte, deliveryID string) error {
	var ev struct {
		Action      string `json:"action"`
		PullRequest *struct {
			ID      int    `json:"id"`
			Number  int    `json:"number"`
			Title   string `json:"title"`
			Body    string `json:"body"`
			State   string `json:"state"`
			HTMLURL string `json:"html_url"`
			Head    *struct {
				Ref  string `json:"ref"`
				Repo *struct {
					ID          int    `json:"id"`
					Name        string `json:"name"`
					FullName    string `json:"full_name"`
					HTMLURL     string `json:"html_url"`
					Description string `json:"description"`
					Private     bool   `json:"private"`
				} `json:"repo"`
			} `json:"head"`
			User *struct {
				ID        int    `json:"id"`
				Login     string `json:"login"`
				AvatarURL string `json:"avatar_url"`
				Email     string `json:"email"`
			} `json:"user"`
		} `json:"pull_request"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to unmarshal github pr event")
		return nil
	}

	pr := ev.PullRequest
	if pr == nil || pr.Head == nil || pr.Head.Repo == nil || pr.User == nil {
		return nil
	}

	switch ev.Action {
	case "opened", "synchronize", "reopened":
	default:
		return nil
	}

	// GitHub retains the delivery ID on redelivery. Distinct deliveries for the
	// same PR (for example, new commits) must not suppress one another.
	if deliveryID == "" {
		return fmt.Errorf("missing X-GitHub-Delivery")
	}
	key := fmt.Sprintf("github:pr_review:%s:%s", bot.ID, deliveryID)
	owner := uuid.NewString()
	claimed, err := h.redis.SetNX(ctx, key, owner, 5*time.Minute).Result()
	if err != nil {
		return fmt.Errorf("claim github delivery: %w", err)
	}
	if !claimed {
		return nil
	}
	succeeded := false
	defer func() {
		if succeeded {
			return
		}
		// Do not remove a newer claim if processing outlives the lease, or if
		// the request context has been cancelled during task creation.
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		const release = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`
		if err := h.redis.Eval(cleanupCtx, release, []string{key}, owner).Err(); err != nil {
			h.logger.With("error", err).ErrorContext(cleanupCtx, "failed to release github delivery")
		}
	}()

	host, err := h.pubhost.PickHost(ctx)
	if err != nil {
		return fmt.Errorf("pick host: %w", err)
	}

	branch := pr.Head.Ref
	repo := pr.Head.Repo
	if _, err := h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  host.ID,
		ImageID: uuid.MustParse(h.cfg.Task.ImageID),
		Prompt:  pr.HTMLURL,
		Git:     taskflow.Git{Token: bot.Token},
		Subject: domain.Subject{
			ID:     fmt.Sprintf("%d", pr.ID),
			Type:   "PullRequest",
			Title:  pr.Title,
			URL:    pr.HTMLURL,
			Number: pr.Number,
		},
		Repo: domain.Repo{
			ID:        fmt.Sprintf("%d", repo.ID),
			Name:      repo.Name,
			FullName:  repo.FullName,
			URL:       repo.HTMLURL,
			Desc:      repo.Description,
			IsPrivate: repo.Private,
			Branch:    &branch,
		},
		Platform: consts.GitPlatformGithub,
		User:     domain.User{Name: pr.User.Login, AvatarURL: pr.User.AvatarURL, Email: pr.User.Email},
		Body:     pr.Body,
		Time:     time.Now(),
		Env:      map[string]string{"GITHUB_TOKEN": bot.Token},
		Bot:      bot,
	}); err != nil {
		return fmt.Errorf("create git task: %w", err)
	}
	succeeded = true
	return nil
}

// --- 公共工具函数 ---

func validateHMACSHA256(secret, signature string, body []byte) error {
	if secret == "" {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return fmt.Errorf("signature mismatch")
	}
	return nil
}

func dedup(ctx context.Context, rdb *redis.Client, key string, logger *slog.Logger) bool {
	ok, err := rdb.SetNX(ctx, fmt.Sprintf("pr_review:%s", key), 1, 5*time.Minute).Result()
	if err != nil {
		logger.With("pr", key).ErrorContext(ctx, "failed to setnx pr review")
		return false
	}
	if !ok {
		logger.With("pr", key).WarnContext(ctx, "skip duplicate pr review")
		return false
	}
	return true
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
