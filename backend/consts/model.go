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

type ModelProvider string

const (
	ModelProviderSiliconFlow ModelProvider = "SiliconFlow"
	ModelProviderOpenAI      ModelProvider = "OpenAI"
	ModelProviderOllama      ModelProvider = "Ollama"
	ModelProviderDeepSeek    ModelProvider = "DeepSeek"
	ModelProviderMoonshot    ModelProvider = "Moonshot"
	ModelProviderAzureOpenAI ModelProvider = "AzureOpenAI"
	ModelProviderBaiZhiCloud ModelProvider = "BaiZhiCloud"
	ModelProviderHunyuan     ModelProvider = "Hunyuan"
	ModelProviderBaiLian     ModelProvider = "BaiLian"
	ModelProviderVolcengine  ModelProvider = "Volcengine"
	ModelProviderZhiPu       ModelProvider = "ZhiPu"
	ModelProviderGemini      ModelProvider = "Gemini"
	ModelProviderOther       ModelProvider = "Other"
)
