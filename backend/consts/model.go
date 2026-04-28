package consts

const (
	ModelApiKeyPrefix = "public:model:"
)

func PublicModelKey(key string) string {
	return ModelApiKeyPrefix + key
}

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
	ModelProviderGoogle      ModelProvider = "Gemini"
)

type InterfaceType string

const (
	InterfaceTypeOpenAIChat     InterfaceType = "openai_chat"
	InterfaceTypeOpenAIResponse InterfaceType = "openai_responses"
	InterfaceTypeAnthropic      InterfaceType = "anthropic"
)
