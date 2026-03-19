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

// GiteeWebhookHandler Gitee Webhook 处理器
type GiteeWebhookHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gitbotUsecase  domain.GitBotUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewGiteeWebhookHandler 创建 Gitee Webhook 处理器
func NewGiteeWebhookHandler(i *do.Injector) (*GiteeWebhookHandler, error) {
	h := &GiteeWebhookHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "GiteeWebhookHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gitbotUsecase:  do.MustInvoke[domain.GitBotUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	w.Group("/api/v1").POST("/gitee/webhook/:id", web.BaseHandler(h.Webhook))

	return h, nil
}

// Webhook 处理 Gitee Webhook 请求
func (h *GiteeWebhookHandler) Webhook(c *web.Context) error {
	ctx := c.Request().Context()
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}

	bot, err := h.gitbotUsecase.GetByID(ctx, id)
	if err != nil {
		return c.String(http.StatusNotFound, "bot not found")
	}

	// Gitee 使用 X-Gitee-Token 验证
	token := c.Request().Header.Get("X-Gitee-Token")
	if bot.SecretToken != "" && token != bot.SecretToken {
		return c.String(http.StatusUnauthorized, "invalid token")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return err
	}

	event := c.Request().Header.Get("X-Gitee-Event")
	if strings.Contains(event, "Merge Request Hook") {
		h.handlePullRequest(ctx, bot, body)
	}

	return c.String(http.StatusOK, "ok")
}

func (h *GiteeWebhookHandler) handlePullRequest(ctx context.Context, bot *domain.GitBot, payload []byte) {
	var ev struct {
		Action      string `json:"action"`
		PullRequest *struct {
			ID           int    `json:"id"`
			Number       int    `json:"number"`
			Title        string `json:"title"`
			Body         string `json:"body"`
			State        string `json:"state"`
			HTMLURL      string `json:"html_url"`
			SourceBranch string `json:"source_branch"`
			User         *struct {
				Login     string `json:"login"`
				Name      string `json:"name"`
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
		h.logger.With("error", err).ErrorContext(ctx, "failed to unmarshal gitee pr event")
		return
	}

	pr := ev.PullRequest
	repo := ev.Repository
	if pr == nil || repo == nil || pr.User == nil {
		return
	}

	state := strings.ToLower(pr.State)
	if state != "open" && state != "opened" {
		return
	}
	action := strings.ToLower(ev.Action)
	switch action {
	case "open", "opened", "update", "updated", "reopen", "reopened", "synchronize":
	default:
		return
	}

	accessToken := resolveToken(ctx, h.gitbotUsecase, bot, h.logger)
	if accessToken == "" {
		return
	}

	key := pr.HTMLURL
	if key == "" {
		key = fmt.Sprintf("%d", pr.ID)
	}
	if !dedup(ctx, h.redis, key, h.logger) {
		return
	}

	branch := pr.SourceBranch
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
		Platform: consts.GitPlatformGitee,
		User:     domain.User{Name: firstNonEmpty(pr.User.Name, pr.User.Login), AvatarURL: pr.User.AvatarURL, Email: pr.User.Email},
		Body:     pr.Body,
		Time:     time.Now(),
		Env:      map[string]string{"GITEE_TOKEN": accessToken},
		Bot:      bot,
	})
}
