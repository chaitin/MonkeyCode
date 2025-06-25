package openai

import (
	"bytes"
	"context"
	"log/slog"
	"text/template"

	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type OpenAIUsecase struct {
	repo   domain.OpenAIRepo
	cfg    *config.Config
	logger *slog.Logger
}

func NewOpenAIUsecase(cfg *config.Config, repo domain.OpenAIRepo, logger *slog.Logger) domain.OpenAIUsecase {
	return &OpenAIUsecase{
		repo:   repo,
		cfg:    cfg,
		logger: logger,
	}
}

func (u *OpenAIUsecase) ModelList(ctx context.Context) (*domain.ModelListResp, error) {
	models, err := u.repo.ModelList(ctx)
	if err != nil {
		return nil, err
	}

	for _, v := range models {
		u.logger.DebugContext(ctx, "model", slog.Any("model", v))
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

	model, err := u.repo.ModelList(ctx)
	if err != nil {
		return nil, err
	}

	chatModel := ""
	codeModel := ""
	for _, m := range model {
		switch m.ModelType {
		case consts.ModelTypeLLM:
			chatModel = m.ModelName
		case consts.ModelTypeCoder:
			codeModel = m.ModelName
		}
	}

	t, err := template.New("config").Parse(string(config.ConfigTmpl))
	if err != nil {
		return nil, err
	}

	cnt := bytes.NewBuffer(nil)
	if err := t.Execute(cnt, map[string]string{
		"apiBase":   u.cfg.BaseUrl,
		"apikey":    apiKey.Key,
		"chatModel": chatModel,
		"codeModel": codeModel,
	}); err != nil {
		return nil, err
	}

	return &domain.ConfigResp{
		Type:    req.Type,
		Content: cnt.String(),
	}, nil
}
