package domain

import (
	"context"
	"net/http"

	"github.com/rokku-c/go-openai"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

// Proxy LLM API代理接口
type Proxy interface {
	AcceptCompletion(ctx context.Context, req *AcceptCompletionReq) error
	HandleCompletion(ctx context.Context, w http.ResponseWriter, req CompletionRequest)
	HandleChatCompletion(ctx context.Context, w http.ResponseWriter, req *openai.ChatCompletionRequest)
	HandleEmbeddings(ctx context.Context, w http.ResponseWriter, req *openai.EmbeddingRequest)
}

type ProxyUsecase interface {
	SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*Model, error)
	Record(ctx context.Context, record *RecordParam) error
	ValidateApiKey(ctx context.Context, key string) (*ApiKey, error)
	AcceptCompletion(ctx context.Context, req *AcceptCompletionReq) error
}

type ProxyRepo interface {
	Record(ctx context.Context, record *db.Record) error
	UpdateByTaskID(ctx context.Context, taskID string, fn func(*db.RecordUpdateOne)) error
	SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*db.Model, error)
	ValidateApiKey(ctx context.Context, key string) (*db.ApiKey, error)
}

type AcceptCompletionReq struct {
	ID         string `json:"id"`         // 记录ID
	Completion string `json:"completion"` // 补全内容
}

type RecordParam struct {
	TaskID          string
	UserID          string
	ModelID         string
	ModelType       consts.ModelType
	Prompt          string
	ProgramLanguage string
	InputTokens     int64
	OutputTokens    int64
	IsAccept        bool
	Completion      string
	WorkMode        string
	CodeLines       int64
}
