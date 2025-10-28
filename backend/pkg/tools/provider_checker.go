package tools

import (
	"context"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

// CheckProvider 根据 model 的前缀来判断 provider
func CheckProvider(ctx context.Context, provider consts.ModelProvider, modelName string) consts.ModelProvider {
	if strings.HasPrefix(modelName, "glm") {
		provider = consts.ModelProviderZhiPu
	}
	return provider
}
