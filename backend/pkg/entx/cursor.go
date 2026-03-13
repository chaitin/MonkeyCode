package entx

import (
	"entgo.io/ent/schema"
)

type CursorKind string

const (
	CursorKindCreatedAt CursorKind = "created_at"
	CursorKindUpdatedAt CursorKind = "updated_at"
)

// CursorPagination 标记该 Schema 需要生成游标分页
// Cursor 目前实现了基于 created_at, id; updated_at, id 的游标分页逻辑
// kind: 指定游标类型，目前支持 created_at 和 updated_at
type CursorPagination struct {
	Kind CursorKind `json:"kind"`
}

var _ schema.Annotation = (*CursorPagination)(nil)

func NewCursor(kind CursorKind) CursorPagination {
	return CursorPagination{
		Kind: kind,
	}
}

func (CursorPagination) Name() string {
	return "CursorPagination"
}
