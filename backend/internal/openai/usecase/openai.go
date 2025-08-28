package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type OpenAIUsecase struct {
	repo      domain.OpenAIRepo
	modelRepo domain.ModelRepo
	cfg       *config.Config
	logger    *slog.Logger
	redis     *redis.Client
}

func NewOpenAIUsecase(
	cfg *config.Config,
	repo domain.OpenAIRepo,
	modelRepo domain.ModelRepo,
	logger *slog.Logger,
	redis *redis.Client,
) domain.OpenAIUsecase {
	return &OpenAIUsecase{
		repo:      repo,
		modelRepo: modelRepo,
		cfg:       cfg,
		logger:    logger,
		redis:     redis,
	}
}

func (u *OpenAIUsecase) ModelList(ctx context.Context) (*domain.ModelListResp, error) {
	models, err := u.repo.ModelList(ctx)
	if err != nil {
		return nil, err
	}

	resp := &domain.ModelListResp{
		Object: "list",
		Data: cvt.Iter(models, func(_ int, m *db.Model) *domain.ModelData {
			return cvt.From(m, &domain.ModelData{})
		}),
	}

	return resp, nil
}

func (u *OpenAIUsecase) GetConfig(ctx context.Context, req *domain.ConfigReq) (*domain.ConfigResp, error) {
	apiKey, err := u.repo.GetApiKey(ctx, req.Key)
	if err != nil {
		return nil, err
	}
	llms, err := u.modelRepo.GetWithCache(ctx, consts.ModelTypeLLM)
	if err != nil {
		return nil, err
	}
	coders, err := u.modelRepo.GetWithCache(ctx, consts.ModelTypeCoder)
	if err != nil {
		return nil, err
	}

	u.logger.With(
		"llms", len(llms),
		"coders", len(coders),
	).DebugContext(ctx, "get config")

	if len(llms) == 0 || len(coders) == 0 {
		return nil, errors.New("no model")
	}

	llm := llms[0]
	coder := coders[0]
	coderkey := fmt.Sprintf("%s.%s", apiKey.UserID.String(), coder.ID.String())
	if err = u.redis.Get(ctx, coderkey).Err(); err != nil {
		b, err := json.Marshal(cvt.From(coder, &domain.Model{}))
		if err != nil {
			return nil, err
		}
		if err = u.redis.Set(ctx, coderkey, string(b), time.Hour*24).Err(); err != nil {
			return nil, err
		}
	}

	if llm.Parameters == nil {
		llm.Parameters = types.DefaultModelParam()
	}

	config := &domain.PluginConfig{
		ProviderProfiles: domain.ProviderProfiles{
			CurrentApiConfigName: "default",
			ApiConfigs:           map[string]domain.ApiConfig{},
			ModeApiConfigs: map[string]string{
				"code":         "59admorkig4",
				"architect":    "59admorkig4",
				"ask":          "59admorkig4",
				"debug":        "59admorkig4",
				"deepresearch": "59admorkig4",
			},
			Migrations: domain.Migrations{
				RateLimitSecondsMigrated: true,
				DiffSettingsMigrated:     true,
			},
		},
		CtcodeTabCompletions: domain.CtcodeTabCompletions{
			Enabled:       true,
			ApiProvider:   "openai",
			OpenAiBaseUrl: req.BaseURL + "/v1",
			OpenAiApiKey:  coderkey,
			OpenAiModelId: coder.ModelName,
		},
	}

	for _, m := range llms {
		key := fmt.Sprintf("%s.%s", apiKey.UserID.String(), m.ID.String())
		if m.Parameters == nil {
			m.Parameters = types.DefaultModelParam()
		}
		name := fmt.Sprintf("%s (%s)", m.ModelName, m.Provider)
		if m.Status == consts.ModelStatusDefault {
			name = "default"
		}
		config.ProviderProfiles.ApiConfigs[name] = domain.ApiConfig{
			ApiProvider:           "openai",
			ApiModelId:            m.ModelName,
			OpenAiBaseUrl:         req.BaseURL + "/v1",
			OpenAiApiKey:          key,
			OpenAiModelId:         m.ModelName,
			OpenAiR1FormatEnabled: m.Parameters.R1Enabled,
			OpenAiCustomModelInfo: domain.OpenAiCustomModelInfo{
				MaxTokens:           m.Parameters.MaxTokens,
				ContextWindow:       m.Parameters.ContextWindow,
				SupportsImages:      m.Parameters.SupprtImages,
				SupportsComputerUse: m.Parameters.SupportComputerUse,
				SupportsPromptCache: m.Parameters.SupportPromptCache,
			},
			Id: m.ID.String(),
		}

		if err = u.redis.Get(ctx, key).Err(); err == nil {
			continue
		}
		b, err := json.Marshal(cvt.From(m, &domain.Model{}))
		if err != nil {
			return nil, err
		}
		if err := u.redis.Set(ctx, key, string(b), time.Hour*24).Err(); err != nil {
			return nil, err
		}
	}

	return &domain.ConfigResp{
		Type:    req.Type,
		Content: config,
	}, nil
}
