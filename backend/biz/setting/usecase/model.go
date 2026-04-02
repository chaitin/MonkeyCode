package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"path"
	"slices"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type modelUsecase struct {
	repo      domain.ModelRepo
	userRepo  domain.UserRepo
	logger    *slog.Logger
	client    *http.Client
	cfg       *config.Config
	modelHook domain.ModelHook
}

func NewModelUsecase(i *do.Injector) (domain.ModelUsecase, error) {
	client := &http.Client{
		Timeout: time.Second * 30,
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			MaxConnsPerHost:     100,
			IdleConnTimeout:     time.Second * 30,
		},
	}
	u := &modelUsecase{
		repo:     do.MustInvoke[domain.ModelRepo](i),
		userRepo: do.MustInvoke[domain.UserRepo](i),
		logger:   do.MustInvoke[*slog.Logger](i),
		client:   client,
		cfg:      do.MustInvoke[*config.Config](i),
	}

	if hook, err := do.Invoke[domain.ModelHook](i); err == nil {
		u.modelHook = hook
	}

	return u, nil
}

func (u *modelUsecase) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) (*domain.ListModelResp, error) {
	ms, cur, err := u.repo.List(ctx, uid, cursor)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to list user model configs from repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to list user model configs: %w", err)
	}

	user, err := u.userRepo.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get user from user repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	models := cvt.Iter(ms, func(_ int, m *db.Model) *domain.Model {
		j := cvt.From(m, &domain.Model{})
		j.IsDefault = j.GetIsDefault(user)
		return j
	})

	if u.modelHook != nil {
		additionalModels, err := u.modelHook.ListPublic(ctx, uid)
		if err != nil {
			u.logger.ErrorContext(ctx, "failed to list additional models from hook", "error", err, "user_id", uid)
			return nil, fmt.Errorf("failed to list additional models: %w", err)
		}
		models = append(models, additionalModels...)
	}

	sort.SliceStable(models, func(i, j int) bool {
		iPublic := models[i].Owner != nil && models[i].Owner.Type == consts.OwnerTypePublic
		jPublic := models[j].Owner != nil && models[j].Owner.Type == consts.OwnerTypePublic
		return iPublic && !jPublic
	})

	return &domain.ListModelResp{
		Models: models,
		Page:   cur,
	}, nil
}

func (u *modelUsecase) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateModelReq) (*domain.Model, error) {
	m, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create model config in repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to create model config: %w", err)
	}
	user, err := u.userRepo.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get user from user repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	j := cvt.From(m, &domain.Model{})
	j.IsDefault = j.GetIsDefault(user)
	return j, nil
}

func (u *modelUsecase) Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error {
	if err := u.repo.Delete(ctx, uid, id); err != nil {
		u.logger.ErrorContext(ctx, "failed to delete model config in repo", "error", err, "user_id", uid, "id", id)
		return fmt.Errorf("failed to delete model config: %w", err)
	}
	return nil
}

func (u *modelUsecase) Update(ctx context.Context, uid, id uuid.UUID, req *domain.UpdateModelReq) error {
	if err := u.repo.Update(ctx, uid, id, req); err != nil {
		u.logger.ErrorContext(ctx, "failed to update model config in repo", "error", err, "user_id", uid, "id", id)
		return fmt.Errorf("failed to update model config: %w", err)
	}
	return nil
}

func (u *modelUsecase) Check(ctx context.Context, uid, id uuid.UUID) (*domain.CheckModelResp, error) {
	m, err := u.repo.Get(ctx, uid, id)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get model config", "error", err, "user_id", uid, "model_id", id)
		return nil, fmt.Errorf("failed to get model config: %w", err)
	}

	checkErr := llm.HealthCheck(ctx, llm.Config{
		BaseURL:       m.BaseURL,
		APIKey:        m.APIKey,
		Model:         m.Model,
		InterfaceType: llm.InterfaceType(m.InterfaceType),
	})

	resp := &domain.CheckModelResp{}
	if checkErr != nil {
		u.logger.WarnContext(ctx, "model health check failed", "model_id", id, "model", m.Model, "error", checkErr)
		resp.Success = false
		resp.Error = checkErr.Error()
		if updateErr := u.repo.UpdateCheckResult(ctx, id, false, checkErr.Error()); updateErr != nil {
			u.logger.ErrorContext(ctx, "failed to update model check result", "model_id", id, "error", updateErr)
		}
	} else {
		u.logger.InfoContext(ctx, "model health check succeeded", "model_id", id, "model", m.Model)
		resp.Success = true
		if updateErr := u.repo.UpdateCheckResult(ctx, id, true, ""); updateErr != nil {
			u.logger.ErrorContext(ctx, "failed to update model check result", "model_id", id, "error", updateErr)
		}
	}

	return resp, nil
}

func (u *modelUsecase) CheckByConfig(ctx context.Context, req *domain.CheckByConfigReq) (*domain.CheckModelResp, error) {
	checkErr := llm.HealthCheck(ctx, llm.Config{
		BaseURL:       req.BaseURL,
		APIKey:        req.APIKey,
		Model:         req.Model,
		InterfaceType: llm.InterfaceType(req.InterfaceType),
	})

	resp := &domain.CheckModelResp{}
	if checkErr != nil {
		u.logger.WarnContext(ctx, "model health check by config failed", "model", req.Model, "error", checkErr)
		resp.Success = false
		resp.Error = checkErr.Error()
	} else {
		u.logger.InfoContext(ctx, "model health check by config succeeded", "model", req.Model)
		resp.Success = true
	}

	return resp, nil
}

func (u *modelUsecase) GetProviderModelList(ctx context.Context, req *domain.GetProviderModelListReq) (*domain.GetProviderModelListResp, error) {
	switch req.Provider {
	case consts.ModelProviderAzureOpenAI,
		consts.ModelProviderVolcengine:
		return &domain.GetProviderModelListResp{
			Models: domain.ModelProviderBrandModelsList[req.Provider],
		}, nil
	case consts.ModelProviderOpenAI,
		consts.ModelProviderHunyuan,
		consts.ModelProviderMoonshot,
		consts.ModelProviderDeepSeek,
		consts.ModelProviderSiliconFlow,
		consts.ModelProviderBaiZhiCloud,
		consts.ModelProviderBaiLian,
		consts.ModelProviderGoogle:
		m, err := url.Parse(req.BaseURL)
		if err != nil {
			return nil, err
		}
		m.Path = path.Join(m.Path, "/models")
		query := u.getQuery(req)

		if u.isOverseasProvider(req.Provider) {
			return u.getModelsWithProxyRetry(ctx, req, m, query)
		}

		client := request.NewClient(m.Scheme, m.Host, u.client.Timeout, request.WithClient(u.client))
		resp, err := request.Get[domain.OpenAIResp](
			client, ctx, m.Path,
			request.WithHeader(
				request.Header{
					"Authorization": fmt.Sprintf("Bearer %s", req.APIKey),
				},
			),
			request.WithQuery(query),
		)
		if err != nil {
			return nil, err
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("get provider model list error: %s (type: %s)", resp.Error.Message, resp.Error.Type)
		}

		return &domain.GetProviderModelListResp{
			Models: cvt.Iter(resp.Data, func(_ int, e *domain.OpenAIData) domain.ProviderModelListItem {
				return domain.ProviderModelListItem{
					Model: e.ID,
				}
			}),
		}, nil

	case consts.ModelProviderOllama:
		m, err := url.Parse(req.BaseURL)
		if err != nil {
			return nil, err
		}
		m.Path = "/api/tags"

		client := request.NewClient(m.Scheme, m.Host, u.client.Timeout, request.WithClient(u.client))

		h := request.Header{}
		if req.APIHeader != "" {
			headers := request.GetHeaderMap(req.APIHeader)
			maps.Copy(h, headers)
		}

		resp, err := request.Get[domain.GetProviderModelListResp](client, ctx, m.Path, request.WithHeader(h))
		if err != nil {
			return nil, err
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("get provider model list error: %s (type: %s)", resp.Error.Message, resp.Error.Type)
		}
		return resp, nil

	default:
		return nil, fmt.Errorf("invalid provider: %s", req.Provider)
	}
}

func (u *modelUsecase) isOverseasProvider(provider consts.ModelProvider) bool {
	overseasProviders := []consts.ModelProvider{
		consts.ModelProviderOpenAI,
		consts.ModelProviderAzureOpenAI,
		consts.ModelProviderGoogle,
	}
	return slices.Contains(overseasProviders, provider)
}

func (u *modelUsecase) getModelsWithProxyRetry(
	ctx context.Context,
	req *domain.GetProviderModelListReq,
	m *url.URL,
	query request.Query,
) (*domain.GetProviderModelListResp, error) {
	header := request.Header{
		"Authorization": fmt.Sprintf("Bearer %s", req.APIKey),
	}

	u.logger.DebugContext(ctx, "trying direct connection (no proxy)", "provider", req.Provider, "url", m.String())
	client := request.NewClient(m.Scheme, m.Host, u.client.Timeout, request.WithClient(u.client))
	resp, err := request.Get[domain.OpenAIResp](
		client, ctx, m.Path,
		request.WithHeader(header),
		request.WithQuery(query),
	)

	if err == nil && resp != nil && resp.Error == nil {
		u.logger.DebugContext(ctx, "direct connection succeeded", "provider", req.Provider)
		return &domain.GetProviderModelListResp{
			Models: cvt.Iter(resp.Data, func(_ int, e *domain.OpenAIData) domain.ProviderModelListItem {
				return domain.ProviderModelListItem{
					Model: e.ID,
				}
			}),
		}, nil
	}

	if err != nil {
		u.logger.WarnContext(ctx, "direct connection failed, trying proxies", "provider", req.Provider, "error", err)
	} else if resp.Error != nil {
		u.logger.WarnContext(ctx, "direct connection failed with API error, trying proxies",
			"provider", req.Provider, "error", resp.Error.Message)
	}

	if len(u.cfg.Proxies) == 0 {
		if err != nil {
			return nil, err
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("get provider model list error: %s (type: %s)", resp.Error.Message, resp.Error.Type)
		}
		return nil, fmt.Errorf("request failed and no proxies configured")
	}

	var lastErr error
	for i, proxyURL := range u.cfg.Proxies {
		u.logger.DebugContext(ctx, "trying proxy", "provider", req.Provider, "proxy", proxyURL, "index", i+1, "total", len(u.cfg.Proxies))

		parsedProxy, err := url.Parse(proxyURL)
		if err != nil {
			u.logger.WarnContext(ctx, "invalid proxy URL, skipping", "proxy", proxyURL, "error", err)
			lastErr = err
			continue
		}

		proxyClient := &http.Client{
			Timeout: u.client.Timeout,
			Transport: &http.Transport{
				Proxy:               http.ProxyURL(parsedProxy),
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 100,
				MaxConnsPerHost:     100,
				IdleConnTimeout:     time.Second * 30,
			},
		}

		client := request.NewClient(m.Scheme, m.Host, u.client.Timeout, request.WithClient(proxyClient))
		resp, err := request.Get[domain.OpenAIResp](
			client, ctx, m.Path,
			request.WithHeader(header),
			request.WithQuery(query),
		)
		if err != nil {
			u.logger.WarnContext(ctx, "proxy request failed", "proxy", proxyURL, "error", err)
			lastErr = err
			continue
		}

		if resp.Error != nil {
			u.logger.WarnContext(ctx, "proxy request failed with API error", "proxy", proxyURL, "error", resp.Error.Message)
			lastErr = fmt.Errorf("get provider model list error: %s (type: %s)", resp.Error.Message, resp.Error.Type)
			continue
		}

		u.logger.InfoContext(ctx, "proxy request succeeded", "provider", req.Provider, "proxy", proxyURL)
		return &domain.GetProviderModelListResp{
			Models: cvt.Iter(resp.Data, func(_ int, e *domain.OpenAIData) domain.ProviderModelListItem {
				return domain.ProviderModelListItem{
					Model: e.ID,
				}
			}),
		}, nil
	}

	u.logger.ErrorContext(ctx, "all proxies failed", "provider", req.Provider, "tried_proxies", len(u.cfg.Proxies))
	if lastErr != nil {
		return nil, fmt.Errorf("all proxies failed, last error: %w", lastErr)
	}
	return nil, fmt.Errorf("all proxies failed")
}

func (u *modelUsecase) getQuery(req *domain.GetProviderModelListReq) request.Query {
	q := make(request.Query, 0)
	if req.Provider != consts.ModelProviderBaiZhiCloud && req.Provider != consts.ModelProviderSiliconFlow {
		return q
	}
	q["type"] = "text"
	q["sub_type"] = "chat"
	return q
}
