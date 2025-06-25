package request

import "net/http"

type ReqOpt func(c *Client)

type Opt func(ctx *Ctx)

func WithDebug() ReqOpt {
	return func(c *Client) {
		c.debug = true
	}
}

func WithTransport(tr *http.Transport) ReqOpt {
	return func(c *Client) {
		c.tr = tr
	}
}

func WithHeader(h Header) Opt {
	return func(ctx *Ctx) {
		ctx.header = h
	}
}

func WithQuery(q Query) Opt {
	return func(ctx *Ctx) {
		ctx.query = q
	}
}

func WithBody(body any) Opt {
	return func(ctx *Ctx) {
		ctx.body = body
	}
}

func WithContentType(contentType string) Opt {
	return func(ctx *Ctx) {
		ctx.contentType = contentType
	}
}
