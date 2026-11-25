package expert

import (
	"encoding/json"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgtype"
)

func knowledgeIDs(raw any) ([]string, error) {
	data, err := json.Marshal(raw)
	var ids []string
	if err != nil || json.Unmarshal(data, &ids) != nil || ids == nil || len(ids) > 50 {
		return nil, resource.InvalidCode("expert_dependencies_invalid", "知识库必须是最多 50 项的 ID 数组")
	}
	for i, id := range ids {
		var parsed pgtype.UUID
		if len(id) != 36 || parsed.Scan(id) != nil || !strings.EqualFold(parsed.String(), id) {
			return nil, resource.InvalidCode("expert_dependencies_invalid", "知识库 ID 无效")
		}
		ids[i] = parsed.String()
	}
	slices.Sort(ids)
	return ids, nil
}
