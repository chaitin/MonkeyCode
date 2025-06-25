package domain

import (
	"context"

	"github.com/rokku-c/go-openai"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

type OpenAIUsecase interface {
	ModelList(ctx context.Context) (*ModelListResp, error)
	GetConfig(ctx context.Context, req *ConfigReq) (*ConfigResp, error)
}

type OpenAIRepo interface {
	GetApiKey(ctx context.Context, key string) (*db.ApiKey, error)
	ModelList(ctx context.Context) ([]*db.Model, error)
}

type CompletionRequest struct {
	openai.CompletionRequest

	Metadata map[string]string `json:"metadata"`
}

type ModelListResp struct {
	Object string       `json:"object"`
	Data   []*ModelData `json:"data"`
}

type ModelData struct {
	ID        string `json:"id"`
	Object    string `json:"object"`
	Created   int64  `json:"created"`
	OwnedBy   string `json:"owned_by"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	BaseModel string `json:"base_model"`
	APIBase   string `json:"api_base"`
	IsActive  bool   `json:"is_active"`
}

func (m *ModelData) From(e *db.Model) *ModelData {
	if e == nil {
		return m
	}

	m.ID = e.ID.String()
	m.Object = "model"
	m.Created = e.CreatedAt.Unix()
	if e.Edges.User != nil {
		m.OwnedBy = e.Edges.User.Username
	}
	m.Name = e.ModelName
	m.Type = string(e.ModelType)
	m.BaseModel = e.ModelName
	m.APIBase = e.APIBase
	m.IsActive = e.Status == consts.ModelStatusActive
	return m
}

type ConfigReq struct {
	Key  string
	Type consts.ConfigType `json:"type"`
}

type ConfigResp struct {
	Type    consts.ConfigType `json:"type"`
	Content string            `json:"content"`
}
