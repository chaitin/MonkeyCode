package identity

import (
	"errors"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5/pgtype"
)

var errCreationGroupUnavailable = errors.New("所选分组不存在或已删除")

func normalizeCreationGroups(ids []string) ([]string, error) {
	if len(ids) > 1000 {
		return nil, errors.New("group_ids 最多包含 1000 个分组")
	}
	if ids == nil {
		return nil, nil
	}
	normalized := make([]string, 0, len(ids))
	for _, id := range ids {
		var value pgtype.UUID
		if err := value.Scan(id); err != nil || !value.Valid {
			return nil, errors.New("group_ids 必须包含有效的分组 UUID")
		}
		if value.String() == rootgroup.ID {
			return nil, errors.New("不能直接加入根分组，请选择子分组或留空")
		}
		normalized = append(normalized, value.String())
	}
	slices.Sort(normalized)
	return slices.Compact(normalized), nil
}
