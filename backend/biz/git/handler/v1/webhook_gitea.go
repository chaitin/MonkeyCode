package v1

import (
	"context"
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

// GiteaWebhookHandler Gitea Webhook 处理器
type GiteaWebhookHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gitbotUsecase  domain.GitBotUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewGiteaWebhookHandler 创建 Gitea Webhook 处理器
func NewGiteaWebhookHandler(i *do.Injector) (*GiteaWebhookHandler, error) {
	h := &GiteaWebhookHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "GiteaWebhookHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gitbotUsecase:  do.MustInvoke[domain.GitBotUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	w.Group("/api/v1").POST("/gitea/webhook/:id", web.BaseHandler(h.Webhook))

	return h, nil
}

// Webhook 处理 Gitea Webhook 请求
func (h *GiteaWebhookHandler) Webhook(c *web.Context) error {
	ctx := c.Request().Context()
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}

	bot, err := h.gitbotUsecase.GetByID(ctx, id)
	if err != nil {
		return c.String(http.StatusNotFound, "bot not found")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return err
	}

	// Gitea 使用 HMAC-SHA256 签名验证（类似 GitHub）
	sig := c.Request().Header.Get("X-Gitea-Signature")
	if err := validateHMACSHA256(bot.SecretToken, "sha256="+sig, body); err != nil {
		return c.String(http.StatusUnauthorized, "invalid signature")
	}

	event := c.Request().Header.Get("X-Gitea-Event")
	if event == "pull_request" {
		h.handlePullRequest(ctx, bot, body)
	}

	return c.String(http.StatusOK, "ok")
}

func (h *GiteaWebhookHandler) handlePullRequest(ctx context.Context, bot *domain.GitBot, payload []byte) {
	var ev struct {
		Action      string `json:"action"`
		PullRequest *struct {
			ID     int    `json:"id"`
			Number int    `json:"number"`
			Title  string `json:"title"`
			Body   string `json:"body"`
			State  string `json:"state"`
			URL    string `json:"html_url"`
			Head   *struct {
				Ref string `json:"ref"`
			} `json:"head"`
			User *struct {
				Login     string `json:"login"`
				FullName  string `json:"full_name"`
				Email     string `json:"email"`
				AvatarURL string `json:"avatar_url"`
			} `json:"user"`
		} `json:"pull_request"`
		Repository *struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			FullName    string `json:"full_name"`
			HTMLURL     string `json:"html_url"`
			Description string `json:"description"`
			Private     bool   `json:"private"`
		} `json:"repository"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to unmarshal gitea pr event")
		return
	}

	pr := ev.PullRequest
	repo := ev.Repository
	if pr == nil || repo == nil || pr.User == nil || pr.Head == nil {
		return
	}

	switch strings.ToLower(ev.Action) {
	case "opened", "synchronized", "reopened":
	default:
		return
	}

	accessToken := resolveToken(ctx, h.gitbotUsecase, bot, h.logger)
	if accessToken == "" {
		return
	}

	key := pr.URL
	if key == "" {
		key = fmt.Sprintf("%d", pr.ID)
	}
	if !dedup(ctx, h.redis, key, h.logger) {
		return
	}

	branch := pr.Head.Ref
	h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  bot.Host.ID,
		ImageID: uuid.MustParse(h.cfg.Task.ImageID),
		Prompt:  key,
		Git:     taskflow.Git{Token: accessToken},
		Subject: domain.Subject{
			ID: fmt.Sprintf("%d", pr.ID), Type: "PullRequest",
			Title: pr.Title, URL: key, Number: pr.Number,
		},
		Repo: domain.Repo{
			ID: fmt.Sprintf("%d", repo.ID), Name: repo.Name,
			FullName: repo.FullName, URL: repo.HTMLURL,
			Desc: repo.Description, IsPrivate: repo.Private, Branch: &branch,
		},
		Platform: consts.GitPlatformGitea,
		User:     domain.User{Name: firstNonEmpty(pr.User.FullName, pr.User.Login), AvatarURL: pr.User.AvatarURL, Email: pr.User.Email},
		Body:     pr.Body,
		Time:     time.Now(),
		Env:      map[string]string{"GITEA_TOKEN": accessToken},
		Bot:      bot,
	})
}
