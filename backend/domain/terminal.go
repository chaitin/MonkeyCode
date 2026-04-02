package domain

import (
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// CloseTerminalReq 关闭终端请求
type CloseTerminalReq struct {
	ID         string `json:"id" query:"id" param:"id" validate:"required"`
	TerminalID string `json:"terminal_id" param:"terminal_id" validate:"required"`
}

// TerminalReq 终端连接请求
type TerminalReq struct {
	ID            string `json:"id" query:"id" param:"id" validate:"required"`
	TerminalID    string `json:"terminal_id" query:"terminal_id"`
	Exec          string `json:"exec" query:"exec"`
	Col           int    `json:"col" query:"col"`
	Row           int    `json:"row" query:"row"`
	EnvironmentID string `json:"-"`
	HostID        string `json:"-"`
	VmID          string `json:"-"`
}

// JoinTerminalReq 加入终端请求
type JoinTerminalReq struct {
	TerminalID string `json:"terminal_id" query:"terminal_id"`
	Password   string `json:"password" query:"password"`
	Col        int    `json:"col" query:"col"`
	Row        int    `json:"row" query:"row"`
}

// SharedTerminal 共享终端信息
type SharedTerminal struct {
	ID         string              `json:"id" query:"id" param:"id" validate:"required"`
	Mode       consts.TerminalMode `json:"mode" query:"mode"`
	TerminalID string              `json:"terminal_id" query:"terminal_id"`
	User       *User               `json:"user"`
}

// ShareTerminalReq 共享终端请求
type ShareTerminalReq struct {
	ID         string              `json:"id" query:"id" param:"id" validate:"required"`
	Mode       consts.TerminalMode `json:"mode" query:"mode"`
	TerminalID string              `json:"terminal_id" query:"terminal_id"`
}

// ShareTerminalResp 共享终端响应
type ShareTerminalResp struct {
	Password string `json:"password"`
}

// TerminalSession 终端会话信息
type TerminalSession struct {
	ID        string              `json:"id"`
	Type      consts.TerminalType `json:"type"`
	CreatedAt int64               `json:"created_at"`
	UpdatedAt int64               `json:"updated_at"`
	IsActive  bool                `json:"is_active"`
}

// Terminal 终端信息
type Terminal struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	ConnectedCount uint32 `json:"connected_count"`
	CreatedAt      int64  `json:"created_at"`
}

// From 从 taskflow 类型转换
func (t *Terminal) From(src *taskflow.Terminal) *Terminal {
	if src == nil {
		return t
	}
	t.ID = src.ID
	t.Title = src.Title
	t.ConnectedCount = src.ConnectedCount
	t.CreatedAt = src.CreatedAt
	return t
}
