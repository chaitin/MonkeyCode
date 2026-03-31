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

// GitlabWebhookHandler GitLab Webhook 处理器
type GitlabWebhookHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gitbotUsecase  domain.GitBotUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewGitlabWebhookHandler 创建 GitLab Webhook 处理器
func NewGitlabWebhookHandler(i *do.Injector) (*GitlabWebhookHandler, error) {
	h := &GitlabWebhookHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "GitlabWebhookHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gitbotUsecase:  do.MustInvoke[domain.GitBotUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	w.Group("/api/v1").POST("/gitlab/webhook/:id", web.BaseHandler(h.Webhook))

	return h, nil
}

// Webhook 处理 GitLab Webhook 请求
func (h *GitlabWebhookHandler) Webhook(c *web.Context) error {
	ctx := c.Request().Context()
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}

	bot, err := h.gitbotUsecase.GetByID(ctx, id)
	if err != nil {
		return c.String(http.StatusNotFound, "bot not found")
	}

	// GitLab 使用 X-Gitlab-Token 验证
	token := c.Request().Header.Get("X-Gitlab-Token")
	if bot.SecretToken != "" && token != bot.SecretToken {
		return c.String(http.StatusUnauthorized, "invalid token")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return err
	}

	event := c.Request().Header.Get("X-Gitlab-Event")
	if strings.Contains(event, "Merge Request Hook") {
		h.handleMergeRequest(ctx, bot, body)
	}

	return c.String(http.StatusOK, "ok")
}

func (h *GitlabWebhookHandler) handleMergeRequest(ctx context.Context, bot *domain.GitBot, payload []byte) {
	var ev struct {
		ObjectAttributes *struct {
			IID          int    `json:"iid"`
			Title        string `json:"title"`
			Description  string `json:"description"`
			State        string `json:"state"`
			Action       string `json:"action"`
			URL          string `json:"url"`
			SourceBranch string `json:"source_branch"`
		} `json:"object_attributes"`
		Project *struct {
			ID                int    `json:"id"`
			Name              string `json:"name"`
			PathWithNamespace string `json:"path_with_namespace"`
			WebURL            string `json:"web_url"`
			Description       string `json:"description"`
			Visibility        string `json:"visibility_level"`
		} `json:"project"`
		User *struct {
			Username  string `json:"username"`
			Name      string `json:"name"`
			Email     string `json:"email"`
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to unmarshal gitlab mr event")
		return
	}

	mr := ev.ObjectAttributes
	proj := ev.Project
	user := ev.User
	if mr == nil || proj == nil || user == nil {
		return
	}

	if mr.State != "opened" && mr.State != "reopened" {
		return
	}
	switch mr.Action {
	case "open", "reopen", "update":
	default:
		return
	}

	if !dedup(ctx, h.redis, mr.URL, h.logger) {
		return
	}

	branch := mr.SourceBranch
	isPrivate := proj.Visibility == "private"
	h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  bot.Host.ID,
		ImageID: uuid.MustParse(h.cfg.Task.ImageID),
		Prompt:  mr.URL,
		Git:     taskflow.Git{Token: bot.Token},
		Subject: domain.Subject{
			ID: fmt.Sprintf("%d", mr.IID), Type: "MergeRequest",
			Title: mr.Title, URL: mr.URL, Number: mr.IID,
		},
		Repo: domain.Repo{
			ID: fmt.Sprintf("%d", proj.ID), Name: proj.Name,
			FullName: proj.PathWithNamespace, URL: proj.WebURL,
			Desc: proj.Description, IsPrivate: isPrivate, Branch: &branch,
		},
		Platform: consts.GitPlatformGitLab,
		User:     domain.User{Name: firstNonEmpty(user.Name, user.Username), AvatarURL: user.AvatarURL, Email: user.Email},
		Body:     mr.Description,
		Time:     time.Now(),
		Env:      map[string]string{"GITLAB_TOKEN": bot.Token},
		Bot:      bot,
	})
}
