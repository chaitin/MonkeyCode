package consts

type ModelStatus string

const (
	ModelStatusActive   ModelStatus = "active"
	ModelStatusInactive ModelStatus = "inactive"
)

type ModelType string

const (
	ModelTypeLLM       ModelType = "llm"
	ModelTypeCoder     ModelType = "coder"
	ModelTypeEmbedding ModelType = "embedding"
	ModelTypeAudio     ModelType = "audio"
	ModelTypeReranker  ModelType = "reranker"
)
