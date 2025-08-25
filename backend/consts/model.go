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
	ModelProviderSiliconFlow    ModelProvider = "SiliconFlow"
	ModelProviderOpenAI         ModelProvider = "OpenAI"
	ModelProviderOllama         ModelProvider = "Ollama"
	ModelProviderDeepSeek       ModelProvider = "DeepSeek"
	ModelProviderMoonshot       ModelProvider = "Moonshot"
	ModelProviderAzureOpenAI    ModelProvider = "AzureOpenAI"
	ModelProviderBaiZhiCloud    ModelProvider = "BaiZhiCloud"
	ModelProviderHunyuan        ModelProvider = "Hunyuan"
	ModelProviderBaiLian        ModelProvider = "BaiLian"
	ModelProviderVolcengine     ModelProvider = "Volcengine"
	ModelProviderZhiPu          ModelProvider = "ZhiPu"
	ModelProviderGemini         ModelProvider = "Gemini"
	ModelProviderAiHubMix       ModelProvider = "AiHubMix"
	ModelProviderOcoolAI        ModelProvider = "OcoolAI"
	ModelProviderPPIO           ModelProvider = "PPIO"
	ModelProviderAlayaNew       ModelProvider = "AlayaNew"
	ModelProviderQiniu          ModelProvider = "Qiniu"
	ModelProviderDMXAPI         ModelProvider = "DMXAPI"
	ModelProviderBurnCloud      ModelProvider = "BurnCloud"
	ModelProviderTokenFlux      ModelProvider = "TokenFlux"
	ModelProvider302AI          ModelProvider = "302AI"
	ModelProviderCephalon       ModelProvider = "Cephalon"
	ModelProviderLanyun         ModelProvider = "Lanyun"
	ModelProviderPH8            ModelProvider = "PH8"
	ModelProviderOpenRouter     ModelProvider = "OpenRouter"
	ModelProviderNewAPI         ModelProvider = "NewAPI"
	ModelProviderLMStudio       ModelProvider = "LMStudio"
	ModelProviderAnthropic      ModelProvider = "Anthropic"
	ModelProviderVertexAI       ModelProvider = "VertexAI"
	ModelProviderGithub         ModelProvider = "Github"
	ModelProviderCopilot        ModelProvider = "Copilot"
	ModelProviderYi             ModelProvider = "Yi"
	ModelProviderBaichuan       ModelProvider = "Baichuan"
	ModelProviderStepFun        ModelProvider = "StepFun"
	ModelProviderInfini         ModelProvider = "Infini"
	ModelProviderMiniMax        ModelProvider = "MiniMax"
	ModelProviderGroq           ModelProvider = "Groq"
	ModelProviderTogether       ModelProvider = "Together"
	ModelProviderFireworks      ModelProvider = "Fireworks"
	ModelProviderNvidia         ModelProvider = "Nvidia"
	ModelProviderGrok           ModelProvider = "Grok"
	ModelProviderHyperbolic     ModelProvider = "Hyperbolic"
	ModelProviderMistral        ModelProvider = "Mistral"
	ModelProviderJina           ModelProvider = "Jina"
	ModelProviderPerplexity     ModelProvider = "Perplexity"
	ModelProviderModelScope     ModelProvider = "ModelScope"
	ModelProviderXirang         ModelProvider = "Xirang"
	ModelProviderTencentCloudTI ModelProvider = "TencentCloudTI"
	ModelProviderBaiduCloud     ModelProvider = "BaiduCloud"
	ModelProviderGPUStack       ModelProvider = "GPUStack"
	ModelProviderVoyageAI       ModelProvider = "VoyageAI"
	ModelProviderAWSBedrock     ModelProvider = "AWSBedrock"
	ModelProviderPoe            ModelProvider = "Poe"
	ModelProviderOther          ModelProvider = "Other"
)
