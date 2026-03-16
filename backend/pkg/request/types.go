package request

import (
	"context"
	"net/http"
)

// Ctx 请求上下文
type Ctx struct {
	body        any
	header      Header
	query       Query
	contentType string
	hook        func(http.Header)
	ctx         context.Context
}

// Response 通用响应
type Response[T any] struct {
	Code    int    `json:"code"`
	Data    T      `json:"data"`
	Message string `json:"message"`
}

// Query 请求查询参数
type Query map[string]string

// Header 请求头
type Header map[string]string
