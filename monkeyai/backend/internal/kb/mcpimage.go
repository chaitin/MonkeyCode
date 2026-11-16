package kb

import (
	"context"
	"encoding/base64"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const mcpImageBase64Limit = (imageUploadLimit + 2) / 3 * 4
const mcpImageRequestLimit = mcpImageBase64Limit + (64 << 10)

func decodeMCPImage(encoded string) ([]byte, error) {
	if len(encoded) == 0 || len(encoded) > mcpImageBase64Limit {
		return nil, resource.Invalid("图片不能为空且不能超过 32 MiB")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return nil, resource.Invalid("图片必须使用标准 Base64 编码，不包含 data URL 前缀")
	}
	if len(data) == 0 || len(data) > imageUploadLimit {
		return nil, resource.Invalid("图片不能为空且不能超过 32 MiB")
	}
	return data, nil
}

func (s *Service) uploadMCPImage(ctx context.Context, actor string, arguments map[string]any) (resource.Object, error) {
	for key := range arguments {
		if key != "kb_id" && key != "data_base64" {
			return nil, resource.Invalid("不支持的图片上传参数: " + key)
		}
	}
	id, err := mcpRequiredString(arguments, "kb_id")
	if err != nil {
		return nil, err
	}
	encoded, err := mcpRequiredString(arguments, "data_base64")
	if err != nil {
		return nil, err
	}
	return s.storeContentImage(ctx, actor, id, false, func() ([]byte, error) {
		return decodeMCPImage(encoded)
	})
}
