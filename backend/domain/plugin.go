package domain

type PluginConfig struct {
	ProviderProfiles     ProviderProfiles     `json:"providerProfiles"`
	CtcodeTabCompletions CtcodeTabCompletions `json:"ctcodeTabCompletions"`
	GlobalSettings       GlobalSettings       `json:"globalSettings"`
}

type ProviderProfiles struct {
	CurrentApiConfigName string               `json:"currentApiConfigName"`
	ApiConfigs           map[string]ApiConfig `json:"apiConfigs"`
	ModeApiConfigs       map[string]string    `json:"modeApiConfigs"`
	Migrations           Migrations           `json:"migrations"`
}

type ApiConfig struct {
	ApiProvider           string                `json:"apiProvider"`
	ApiModelId            string                `json:"apiModelId"`
	OpenAiBaseUrl         string                `json:"openAiBaseUrl"`
	OpenAiApiKey          string                `json:"openAiApiKey"`
	OpenAiModelId         string                `json:"openAiModelId"`
	OpenAiR1FormatEnabled bool                  `json:"openAiR1FormatEnabled"`
	OpenAiCustomModelInfo OpenAiCustomModelInfo `json:"openAiCustomModelInfo"`
	Id                    string                `json:"id"`
}

type OpenAiCustomModelInfo struct {
	MaxTokens           int  `json:"maxTokens"`
	ContextWindow       int  `json:"contextWindow"`
	SupportsImages      bool `json:"supportsImages"`
	SupportsComputerUse bool `json:"supportsComputerUse"`
	SupportsPromptCache bool `json:"supportsPromptCache"`
}

type Migrations struct {
	RateLimitSecondsMigrated bool `json:"rateLimitSecondsMigrated"`
	DiffSettingsMigrated     bool `json:"diffSettingsMigrated"`
}

type CtcodeTabCompletions struct {
	Enabled       bool   `json:"enabled"`
	ApiProvider   string `json:"apiProvider"`
	OpenAiBaseUrl string `json:"openAiBaseUrl"`
	OpenAiApiKey  string `json:"openAiApiKey"`
	OpenAiModelId string `json:"openAiModelId"`
}

type GlobalSettings struct {
	AllowedCommands []string `json:"allowedCommands"`
	Mode            string   `json:"mode"`
	CustomModes     []string `json:"customModes"`
}
