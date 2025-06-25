package domain

import (
	"context"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type BillingUsecase interface {
	ListChatRecord(ctx context.Context, page *web.Pagination) (*ListChatRecordResp, error)
	ListCompletionRecord(ctx context.Context, page *web.Pagination) (*ListCompletionRecordResp, error)
	CompletionInfo(ctx context.Context, id string) (*CompletionInfo, error)
	ChatInfo(ctx context.Context, id string) (*ChatInfo, error)
}

type BillingRepo interface {
	ListChatRecord(ctx context.Context, page *web.Pagination) (*ListChatRecordResp, error)
	ListCompletionRecord(ctx context.Context, page *web.Pagination) (*ListCompletionRecordResp, error)
	CompletionInfo(ctx context.Context, id string) (*CompletionInfo, error)
	ChatInfo(ctx context.Context, id string) (*ChatInfo, error)
}

type ListChatRecordResp struct {
	*db.PageInfo

	Records []*ChatRecord `json:"records"`
}

type ListCompletionRecordResp struct {
	*db.PageInfo

	Records []*CompletionRecord `json:"records"`
}

type ChatRecord struct {
	ID           string `json:"id"`            // 记录ID
	User         *User  `json:"user"`          // 用户
	Model        *Model `json:"model"`         // 模型
	Question     string `json:"question"`      // 问题
	WorkMode     string `json:"work_mode"`     // 工作模式
	InputTokens  int64  `json:"input_tokens"`  // 输入token
	OutputTokens int64  `json:"output_tokens"` // 输出token
	CreatedAt    int64  `json:"created_at"`    // 创建时间
}

func (c *ChatRecord) From(e *db.Record) *ChatRecord {
	if e == nil {
		return c
	}
	c.ID = e.ID.String()
	c.Question = e.Prompt
	c.User = cvt.From(e.Edges.User, &User{})
	c.Model = cvt.From(e.Edges.Model, &Model{})
	c.WorkMode = e.WorkMode
	c.InputTokens = e.InputTokens
	c.OutputTokens = e.OutputTokens
	c.CreatedAt = e.CreatedAt.Unix()
	return c
}

type CompletionRecord struct {
	ID              string `json:"id"`               // 记录ID
	User            *User  `json:"user"`             // 用户
	IsAccept        bool   `json:"is_accept"`        // 是否采纳
	ProgramLanguage string `json:"program_language"` // 编程语言
	InputTokens     int64  `json:"input_tokens"`     // 输入token
	OutputTokens    int64  `json:"output_tokens"`    // 输出token
	CreatedAt       int64  `json:"created_at"`       // 创建时间
}

func (c *CompletionRecord) From(e *db.Record) *CompletionRecord {
	if e == nil {
		return c
	}
	c.ID = e.ID.String()
	c.IsAccept = e.IsAccept
	c.User = cvt.From(e.Edges.User, &User{})
	c.ProgramLanguage = e.ProgramLanguage
	c.InputTokens = e.InputTokens
	c.OutputTokens = e.OutputTokens
	c.CreatedAt = e.CreatedAt.Unix()
	return c
}

type CompletionInfo struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

func (c *CompletionInfo) From(e *db.Record) *CompletionInfo {
	if e == nil {
		return c
	}
	c.ID = e.ID.String()
	c.Content = e.Completion
	c.CreatedAt = e.CreatedAt.Unix()
	return c
}

type ChatInfo struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

func (c *ChatInfo) From(e *db.Record) *ChatInfo {
	if e == nil {
		return c
	}
	c.ID = e.ID.String()
	c.Content = e.Completion
	c.CreatedAt = e.CreatedAt.Unix()
	return c
}

type BillingUsage struct {
	ID        string `json:"id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	UserID    string `json:"user_id"`
	ModelName string `json:"model_name"`
	Tokens    int64  `json:"tokens"`
	Operation string `json:"operation"`
}

type BillingQuota struct {
	ID        string `json:"id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	UserID    string `json:"user_id"`
	Total     int64  `json:"total"`
	Used      int64  `json:"used"`
	Remain    int64  `json:"remain"`
}

func (b *BillingQuota) From(e *db.BillingQuota) *BillingQuota {
	if e == nil {
		return b
	}
	b.ID = e.ID
	b.UserID = e.UserID
	b.Total = e.Total
	b.Used = e.Used
	b.Remain = e.Remain
	b.CreatedAt = e.CreatedAt.Unix()
	b.UpdatedAt = e.UpdatedAt.Unix()
	return b
}

type ApiKey struct {
	ID        string `json:"id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	UserID    string `json:"user_id"`
	Key       string `json:"key"`
}

func (a *ApiKey) From(e *db.ApiKey) *ApiKey {
	if e == nil {
		return a
	}
	a.ID = e.ID.String()
	a.UserID = e.UserID.String()
	a.Key = e.Key
	a.CreatedAt = e.CreatedAt.Unix()
	a.UpdatedAt = e.UpdatedAt.Unix()
	return a
}
