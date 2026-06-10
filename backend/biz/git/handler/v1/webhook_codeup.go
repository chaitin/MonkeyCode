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

// CodeupWebhookHandler 云效 Codeup Webhook 处理器
type CodeupWebhookHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gitbotUsecase  domain.GitBotUsecase
	pubhost        domain.PublicHostUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewCodeupWebhookHandler 创建 Codeup Webhook 处理器
func NewCodeupWebhookHandler(i *do.Injector) (*CodeupWebhookHandler, error) {
	h := &CodeupWebhookHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "CodeupWebhookHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gitbotUsecase:  do.MustInvoke[domain.GitBotUsecase](i),
		pubhost:        do.MustInvoke[domain.PublicHostUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	w.Group("/api/v1").POST("/codeup/webhook/:id", web.BaseHandler(h.Webhook))

	return h, nil
}

// Webhook 处理 Codeup Webhook 请求
//
// Codeup 在 Header `X-Codeup-Token` 或 `X-Yunxiao-Token` 中携带 secretToken 校验；
// 事件类型在 `X-Event-Type` / `X-Codeup-Event` 中。
func (h *CodeupWebhookHandler) Webhook(c *web.Context) error {
	ctx := c.Request().Context()
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}

	bot, err := h.gitbotUsecase.GetByID(ctx, id)
	if err != nil {
		return c.String(http.StatusNotFound, "bot not found")
	}

	token := firstNonEmptyHeader(c.Request().Header,
		"X-Codeup-Token", "X-Yunxiao-Token", "X-Gitlab-Token")
	if bot.SecretToken != "" && token != bot.SecretToken {
		return c.String(http.StatusUnauthorized, "invalid token")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return err
	}

	event := firstNonEmptyHeader(c.Request().Header,
		"X-Event-Type", "X-Codeup-Event", "X-Gitlab-Event")
	if strings.Contains(strings.ToLower(event), "merge request") ||
		strings.Contains(strings.ToLower(event), "pull request") ||
		strings.Contains(strings.ToLower(event), "mergerequest") {
		h.handlePullRequest(ctx, bot, body)
	}

	return c.String(http.StatusOK, "ok")
}

func (h *CodeupWebhookHandler) handlePullRequest(ctx context.Context, bot *domain.GitBot, payload []byte) {
	// Codeup MR 事件大致遵循 GitLab 风格 payload
	var ev struct {
		ObjectKind       string `json:"object_kind"`
		EventType        string `json:"event_type"`
		ObjectAttributes *struct {
			ID           int    `json:"id"`
			IID          int    `json:"iid"`
			Title        string `json:"title"`
			Description  string `json:"description"`
			State        string `json:"state"`
			Action       string `json:"action"`
			URL          string `json:"url"`
			SourceBranch string `json:"source_branch"`
			TargetBranch string `json:"target_branch"`
		} `json:"object_attributes"`
		User *struct {
			ID        int    `json:"id"`
			Username  string `json:"username"`
			Name      string `json:"name"`
			Email     string `json:"email"`
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
		Repository *struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			FullName    string `json:"full_name"`
			URL         string `json:"url"`
			GitHTTPURL  string `json:"git_http_url"`
			Description string `json:"description"`
			Homepage    string `json:"homepage"`
			Visibility  string `json:"visibility"`
		} `json:"repository"`
		Project *struct {
			ID                int    `json:"id"`
			Name              string `json:"name"`
			PathWithNamespace string `json:"path_with_namespace"`
			WebURL            string `json:"web_url"`
			Description       string `json:"description"`
			Visibility        string `json:"visibility"`
		} `json:"project"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to unmarshal codeup mr event")
		return
	}

	mr := ev.ObjectAttributes
	if mr == nil || ev.User == nil {
		return
	}

	state := strings.ToLower(mr.State)
	if state != "open" && state != "opened" {
		return
	}
	switch strings.ToLower(mr.Action) {
	case "open", "opened", "update", "updated", "reopen", "reopened", "synchronize":
	default:
		return
	}

	key := mr.URL
	if key == "" {
		key = fmt.Sprintf("%d", mr.ID)
	}
	if !dedup(ctx, h.redis, key, h.logger) {
		return
	}

	repoID, repoName, repoFullName, repoURL, repoDesc := "", "", "", "", ""
	isPrivate := false
	switch {
	case ev.Repository != nil:
		repoID = fmt.Sprintf("%d", ev.Repository.ID)
		repoName = ev.Repository.Name
		repoFullName = ev.Repository.FullName
		repoURL = firstNonEmpty(ev.Repository.URL, ev.Repository.Homepage, ev.Repository.GitHTTPURL)
		repoDesc = ev.Repository.Description
		isPrivate = strings.EqualFold(ev.Repository.Visibility, "private") || ev.Repository.Visibility == ""
	case ev.Project != nil:
		repoID = fmt.Sprintf("%d", ev.Project.ID)
		repoName = ev.Project.Name
		repoFullName = ev.Project.PathWithNamespace
		repoURL = ev.Project.WebURL
		repoDesc = ev.Project.Description
		isPrivate = strings.EqualFold(ev.Project.Visibility, "private") || ev.Project.Visibility == ""
	default:
		return
	}

	host, err := h.pubhost.PickHost(ctx)
	if err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to pick host")
		return
	}

	branch := mr.SourceBranch
	if _, err := h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  host.ID,
		ImageID: uuid.MustParse(h.cfg.Task.ImageID),
		Prompt:  key,
		Git:     taskflow.Git{Token: bot.Token},
		Subject: domain.Subject{
			ID: fmt.Sprintf("%d", mr.ID), Type: "PullRequest",
			Title: mr.Title, URL: key, Number: mr.IID,
		},
		Repo: domain.Repo{
			ID: repoID, Name: repoName,
			FullName: repoFullName, URL: repoURL,
			Desc: repoDesc, IsPrivate: isPrivate, Branch: &branch,
		},
		Platform: consts.GitPlatformCodeup,
		User: domain.User{
			Name:      firstNonEmpty(ev.User.Name, ev.User.Username),
			AvatarURL: ev.User.AvatarURL,
			Email:     ev.User.Email,
		},
		Body: mr.Description,
		Time: time.Now(),
		Env:  map[string]string{"CODEUP_TOKEN": bot.Token},
		Bot:  bot,
	}); err != nil {
		h.logger.With("error", err).ErrorContext(ctx, "failed to create git task")
	}
}

func firstNonEmptyHeader(h http.Header, keys ...string) string {
	for _, k := range keys {
		if v := h.Get(k); v != "" {
			return v
		}
	}
	return ""
}
