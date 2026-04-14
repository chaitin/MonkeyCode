package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/GoYoko/web"
	gh "github.com/google/go-github/v74/github"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	githubclient "github.com/chaitin/MonkeyCode/backend/pkg/git/github"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type githubAppClient interface {
	GetInstallation(ctx context.Context, installationID int64) (*gh.Installation, error)
	GetInstallationToken(ctx context.Context, installationID int64) (string, error)
	GetPullRequest(ctx context.Context, token, pullRequestURL string) (*gh.PullRequest, error)
}

// GithubAppHandler 处理 GitHub App setup 与 callback 请求
type GithubAppHandler struct {
	cfg            *config.Config
	logger         *slog.Logger
	redis          *redis.Client
	gh             githubAppClient
	gitIdentityUse domain.GitIdentityUsecase
	gitTaskUsecase domain.GitTaskUsecase
}

// NewGithubAppHandler 创建 GitHub App 处理器
func NewGithubAppHandler(i *do.Injector) (*GithubAppHandler, error) {
	h := &GithubAppHandler{
		cfg:            do.MustInvoke[*config.Config](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "GithubAppHandler"),
		redis:          do.MustInvoke[*redis.Client](i),
		gh:             githubclient.NewGithub(do.MustInvoke[*slog.Logger](i), do.MustInvoke[*config.Config](i)),
		gitIdentityUse: do.MustInvoke[domain.GitIdentityUsecase](i),
		gitTaskUsecase: do.MustInvoke[domain.GitTaskUsecase](i),
	}

	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	w.Group("/api/v1").POST("/github/app/callback", web.BaseHandler(h.Callback))
	w.Group("/api/v1").GET("/github/app/setup", web.BindHandler(h.GithubAppSetup), auth.Auth())

	return h, nil
}

// Callback 处理 GitHub App callback
func (h *GithubAppHandler) Callback(c *web.Context) error {
	body, err := gh.ValidatePayload(c.Request(), []byte(h.cfg.Github.App.WebhookSecret))
	if err != nil {
		return fmt.Errorf("validate github app payload: %w", err)
	}

	switch c.Request().Header.Get("X-Github-Event") {
	case "installation":
		h.handleInstallation(c.Request().Context(), body)
	case "issue_comment":
		if err := h.handleIssueComment(c.Request().Context(), body); err != nil {
			h.logger.With("error", err).ErrorContext(c.Request().Context(), "failed to handle github app issue comment")
			return c.String(http.StatusInternalServerError, "retry later")
		}
	}

	return c.String(http.StatusOK, "ok")
}

// GithubAppSetup 处理 GitHub App 安装完成后的绑定回跳
func (h *GithubAppHandler) GithubAppSetup(c *web.Context, req domain.GithubAppSetupReq) error {
	ctx := c.Request().Context()
	user := middleware.GetUser(c)
	if user == nil {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	redirectURL := h.cfg.GetGithubAppInstallRedirectURL()
	if err := req.Validation(); err != nil {
		return c.Redirect(http.StatusFound, redirectURL+"?github_setup=error&reason=not_owner&message="+url.QueryEscape(err.Error()))
	}

	inst, err := h.gh.GetInstallation(ctx, req.InstallationID)
	if err != nil {
		h.logger.With("error", err, "installation_id", req.InstallationID).WarnContext(ctx, "failed to get github installation")
		return c.Redirect(http.StatusFound, redirectURL+"?github_setup=error&reason=github_api_error")
	}

	accountLogin := ""
	if inst.Account != nil {
		accountLogin = inst.GetAccount().GetLogin()
	}

	_, err = h.gitIdentityUse.UpsertByInstallationID(ctx, user.ID, &domain.UpsertGitIdentityByInstallationReq{
		InstallationID: req.InstallationID,
		AccountLogin:   accountLogin,
		Platform:       consts.GitPlatformGithub,
	})
	if err != nil {
		h.logger.With("error", err, "user_id", user.ID, "installation_id", req.InstallationID).ErrorContext(ctx, "failed to upsert github app installation identity")
		return c.Redirect(http.StatusFound, redirectURL+"?github_setup=error&reason=save_failed")
	}

	return c.Redirect(http.StatusFound, fmt.Sprintf("%s?github_setup=success&installation_id=%d&account_login=%s", redirectURL, req.InstallationID, url.QueryEscape(accountLogin)))
}

func (h *GithubAppHandler) handleInstallation(ctx context.Context, body []byte) {
	var ev gh.InstallationEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		h.logger.With("error", err).WarnContext(ctx, "failed to unmarshal installation event")
		return
	}
	if ev.Installation != nil && ev.Installation.GetAppID() != 0 && ev.Installation.GetAppID() != h.cfg.Github.App.ID {
		h.logger.With("event_app_id", ev.Installation.GetAppID(), "config_app_id", h.cfg.Github.App.ID).
			WarnContext(ctx, "skip github installation event for mismatched app id")
		return
	}
	h.logger.With("action", ev.GetAction()).InfoContext(ctx, "received github installation event")
}

func (h *GithubAppHandler) handleIssueComment(ctx context.Context, body []byte) error {
	var ev gh.IssueCommentEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return fmt.Errorf("unmarshal issue comment event: %w", err)
	}
	if ev.GetAction() != "created" || ev.Comment == nil || ev.Comment.User == nil || ev.Issue == nil {
		return nil
	}
	if ev.Comment.User.GetType() == "Bot" {
		return nil
	}

	commentBody := strings.ToLower(ev.Comment.GetBody())
	if strings.Contains(commentBody, "> 我是 [monkeycode ai 编程助手]") {
		return nil
	}
	if h.cfg.Task.AtKeyword != "" && !strings.Contains(commentBody, strings.ToLower(h.cfg.Task.AtKeyword)) {
		return nil
	}
	if ev.Issue.PullRequestLinks == nil || ev.Issue.PullRequestLinks.GetURL() == "" {
		return nil
	}
	if h.issueCommentHandled(ctx, ev.Comment.GetID()) {
		return nil
	}

	installID := int64(0)
	if ev.Installation != nil {
		installID = ev.Installation.GetID()
	}
	if installID == 0 {
		return fmt.Errorf("missing github installation id")
	}

	token, err := h.gh.GetInstallationToken(ctx, installID)
	if err != nil {
		return fmt.Errorf("get installation token: %w", err)
	}
	pr, err := h.gh.GetPullRequest(ctx, token, ev.Issue.PullRequestLinks.GetURL())
	if err != nil {
		return fmt.Errorf("get pull request: %w", err)
	}

	if err := h.createGitTaskFromIssueComment(ctx, &ev, pr, token, installID); err != nil {
		return err
	}
	h.markIssueCommentHandled(ctx, ev.Comment.GetID())
	return nil
}

func (h *GithubAppHandler) createGitTaskFromIssueComment(ctx context.Context, ev *gh.IssueCommentEvent, pr *gh.PullRequest, token string, installID int64) error {
	if len(h.cfg.Task.HostIDs) == 0 {
		return fmt.Errorf("task.host_ids is empty")
	}
	imageID, err := uuid.Parse(h.cfg.Task.ImageID)
	if err != nil {
		return fmt.Errorf("parse task image id: %w", err)
	}
	if pr == nil || pr.Head == nil || pr.Head.Repo == nil || ev.Comment == nil || ev.Comment.User == nil {
		return fmt.Errorf("pull request payload incomplete")
	}

	branch := pr.Head.GetRef()
	_, err = h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
		HostID:  h.cfg.Task.HostIDs[0],
		ImageID: imageID,
		Prompt:  pr.GetHTMLURL(),
		Git:     taskflow.Git{Token: token},
		Subject: domain.Subject{
			ID:     fmt.Sprintf("%d", pr.GetID()),
			Type:   "PullRequest",
			Title:  pr.GetTitle(),
			URL:    pr.GetHTMLURL(),
			Number: pr.GetNumber(),
		},
		Repo: domain.Repo{
			ID:        fmt.Sprintf("%d", pr.Head.Repo.GetID()),
			Name:      pr.Head.Repo.GetName(),
			FullName:  pr.Head.Repo.GetFullName(),
			URL:       pr.Head.Repo.GetHTMLURL(),
			Desc:      pr.Head.Repo.GetDescription(),
			IsPrivate: pr.Head.Repo.GetPrivate(),
			Branch:    &branch,
		},
		Platform:             consts.GitPlatformGithub,
		User:                 domain.User{Name: ev.Comment.User.GetLogin(), AvatarURL: ev.Comment.User.GetAvatarURL(), Email: ev.Comment.User.GetEmail()},
		Body:                 ev.Comment.GetBody(),
		Time:                 time.Now(),
		GithubInstallationID: installID,
		Env:                  map[string]string{"GITHUB_TOKEN": token},
	})
	return err
}

func (h *GithubAppHandler) issueCommentHandled(ctx context.Context, commentID int64) bool {
	if h.redis == nil {
		return false
	}
	exists, err := h.redis.Exists(ctx, fmt.Sprintf("github_app_issue_comment:%d", commentID)).Result()
	if err != nil {
		h.logger.With("error", err, "comment_id", commentID).WarnContext(ctx, "failed to query github issue comment dedup key")
		return false
	}
	return exists > 0
}

func (h *GithubAppHandler) markIssueCommentHandled(ctx context.Context, commentID int64) {
	if h.redis == nil {
		return
	}
	if err := h.redis.Set(ctx, fmt.Sprintf("github_app_issue_comment:%d", commentID), 1, 5*time.Minute).Err(); err != nil {
		h.logger.With("error", err, "comment_id", commentID).WarnContext(ctx, "failed to mark github issue comment handled")
	}
}
