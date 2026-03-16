package request

import (
	"context"
	"net/http"
)

// ReqOpt Client 配置选项
type ReqOpt func(c *Client)

// Opt 请求选项
type Opt func(ctx *Ctx)

// WithDebug 开启调试模式
func WithDebug() ReqOpt {
	return func(c *Client) {
		c.debug = true
	}
}

// WithClient 自定义 HTTP Client
func WithClient(client *http.Client) ReqOpt {
	return func(c *Client) {
		c.client = client
	}
}

// WithTransport 自定义 Transport
func WithTransport(tr *http.Transport) ReqOpt {
	return func(c *Client) {
		c.tr = tr
	}
}

// WithHeader 设置请求头
func WithHeader(h Header) Opt {
	return func(ctx *Ctx) {
		ctx.header = h
	}
}

// WithQuery 设置查询参数
func WithQuery(q Query) Opt {
	return func(ctx *Ctx) {
		ctx.query = q
	}
}

// WithBody 设置请求体
func WithBody(body any) Opt {
	return func(ctx *Ctx) {
		ctx.body = body
	}
}

// WithContentType 设置 Content-Type
func WithContentType(contentType string) Opt {
	return func(ctx *Ctx) {
		ctx.contentType = contentType
	}
}

// WithHook 设置响应 Header 钩子
func WithHook(hook func(http.Header)) Opt {
	return func(ctx *Ctx) {
		ctx.hook = hook
	}
}

// WithContext 设置请求上下文
func WithContext(c context.Context) Opt {
	return func(ctx *Ctx) {
		ctx.ctx = c
	}
}
