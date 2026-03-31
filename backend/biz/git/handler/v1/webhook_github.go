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
	if event == "pull_request" {
		h.handlePullRequest(ctx, bot, body)
	}

	return c.String(http.StatusOK, "ok")
}

func (h *GithubWebhookHandler) handlePullRequest(ctx context.Context, bot *domain.GitBot, payload []byte) {
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
		return
	}

	pr := ev.PullRequest
	if pr == nil || pr.Head == nil || pr.Head.Repo == nil || pr.User == nil {
		return
	}

	switch ev.Action {
	case "opened", "synchronize", "reopened":
	default:
		return
	}

	if !dedup(ctx, h.redis, pr.HTMLURL, h.logger) {
		return
	}

	branch := pr.Head.Ref
	repo := pr.Head.Repo
	h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  bot.Host.ID,
		ImageID: uuid.MustParse(h.cfg.Task.ImageID),
		Prompt:  pr.HTMLURL,
		Git:     taskflow.Git{Token: bot.Token},
		Subject: domain.Subject{
			ID: fmt.Sprintf("%d", pr.ID), Type: "PullRequest",
			Title: pr.Title, URL: pr.HTMLURL, Number: pr.Number,
		},
		Repo: domain.Repo{
			ID: fmt.Sprintf("%d", repo.ID), Name: repo.Name,
			FullName: repo.FullName, URL: repo.HTMLURL,
			Desc: repo.Description, IsPrivate: repo.Private, Branch: &branch,
		},
		Platform: consts.GitPlatformGithub,
		User:     domain.User{Name: pr.User.Login, AvatarURL: pr.User.AvatarURL, Email: pr.User.Email},
		Body:     pr.Body,
		Time:     time.Now(),
		Env:      map[string]string{"GITHUB_TOKEN": bot.Token},
		Bot:      bot,
	})
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
