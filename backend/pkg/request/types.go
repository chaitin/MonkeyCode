package request

import (
	"context"
	"fmt"
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
	client      *http.Client
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

// HTTPError 保留非成功响应的状态码和响应体，供上层协议解析。
type HTTPError struct {
	StatusCode int
	Body       []byte
}

func (e *HTTPError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, string(e.Body))
}
