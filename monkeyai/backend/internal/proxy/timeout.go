package proxy

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"time"
)

const (
	upstreamHeaderTimeout  = 5 * time.Minute
	upstreamReadTimeout    = 5 * time.Minute
	upstreamRequestTimeout = 30 * time.Minute
)

type upstreamTimeoutError string

func (e upstreamTimeoutError) Error() string          { return string(e) }
func (e upstreamTimeoutError) DiagnosticCode() string { return "upstream_timeout" }
func (e upstreamTimeoutError) Timeout() bool          { return true }
func (e upstreamTimeoutError) Temporary() bool        { return true }
func (e upstreamTimeoutError) Is(err error) bool      { return err == context.DeadlineExceeded }

var errUpstreamClosed = errors.New("上游响应已关闭")

const (
	errUpstreamReadTimeout    = upstreamTimeoutError("等待上游响应数据超时")
	errUpstreamRequestTimeout = upstreamTimeoutError("上游请求总时限已到")
)

type timeoutTransport struct {
	base           http.RoundTripper
	requestTimeout time.Duration
	readTimeout    time.Duration
}

func withUpstreamTimeouts(base http.RoundTripper) timeoutTransport {
	return timeoutTransport{base: base, requestTimeout: upstreamRequestTimeout, readTimeout: upstreamReadTimeout}
}

func (t timeoutTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx, stop := context.WithTimeoutCause(req.Context(), t.requestTimeout, errUpstreamRequestTimeout)
	ctx, cancel := context.WithCancelCause(ctx)
	response, err := t.base.RoundTrip(req.WithContext(ctx))
	if err != nil {
		if cause := context.Cause(ctx); cause != nil {
			err = cause
		}
		cancel(nil)
		stop()
		return nil, err
	}
	response.Body = &timeoutBody{src: response.Body, ctx: ctx, cancel: cancel, stop: stop, timeout: t.readTimeout}
	return response, nil
}

type timeoutBody struct {
	src     io.ReadCloser
	ctx     context.Context
	cancel  context.CancelCauseFunc
	stop    context.CancelFunc
	timeout time.Duration
}

func (b *timeoutBody) Read(buffer []byte) (int, error) {
	// 仅计算等待上游读取的时间，避免将下游背压算作上游无数据。
	timer := time.AfterFunc(b.timeout, func() { b.cancel(errUpstreamReadTimeout) })
	n, err := b.src.Read(buffer)
	timer.Stop()
	if cause := context.Cause(b.ctx); cause != nil {
		err = cause
	}
	if err != nil {
		b.cancel(errUpstreamClosed)
		b.stop()
	}
	return n, err
}

func (b *timeoutBody) Close() error {
	b.cancel(errUpstreamClosed)
	b.stop()
	return b.src.Close()
}

func upstreamTimedOut(ctx context.Context, err error) bool {
	var timeout net.Error
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(context.Cause(ctx), context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout())
}
