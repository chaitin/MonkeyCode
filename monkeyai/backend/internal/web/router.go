package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
)

type Router struct {
	router     chi.Router
	bodyLimit  int64
	decodeCode string
	mapError   func(error) *Error
}

func Routes(router chi.Router) *Router {
	return &Router{router: router, bodyLimit: 1 << 20, decodeCode: "invalid_json"}
}
func (a *Router) WithErrorMapper(mapper func(error) *Error) *Router { a.mapError = mapper; return a }
func (a *Router) WithBodyLimit(limit int64) *Router                 { a.bodyLimit = limit; return a }
func (a *Router) WithDecodeCode(code string) *Router                { a.decodeCode = code; return a }
func (a *Router) Get[O any](path string, handler func(context.Context) (O, error)) {
	a.Handle(http.MethodGet, path, 200, handler)
}
func (a *Router) Post[I, O any](path string, handler func(context.Context, I) (O, error)) {
	a.Bind(http.MethodPost, path, 201, handler)
}
func (a *Router) Handle[O any](method, path string, status int, handler func(context.Context) (O, error)) {
	a.router.MethodFunc(method, path, func(w http.ResponseWriter, r *http.Request) {
		value, err := handler(r.Context())
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if status == http.StatusNoContent {
			w.WriteHeader(status)
			return
		}
		JSON(r.Context(), w, status, value)
	})
}
func (a *Router) Bind[I, O any](method, path string, status int, handler func(context.Context, I) (O, error)) {
	a.router.MethodFunc(method, path, func(w http.ResponseWriter, r *http.Request) {
		var input I
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, a.bodyLimit))
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			a.fail(w, r, &Error{Status: 400, Code: a.decodeCode, Message: "请求格式无效", Cause: err})
			return
		}
		raw = bytes.TrimSpace(raw)
		if len(raw) == 0 || raw[0] != '{' {
			a.fail(w, r, &Error{Status: 400, Code: a.decodeCode, Message: "请求必须为 JSON 对象"})
			return
		}
		strict := json.NewDecoder(bytes.NewReader(raw))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&input); err != nil {
			a.fail(w, r, &Error{Status: 400, Code: a.decodeCode, Message: "请求格式无效", Cause: err})
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			a.fail(w, r, &Error{Status: 400, Code: a.decodeCode, Message: "请求只能包含一个 JSON 对象"})
			return
		}
		value, err := handler(r.Context(), input)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		JSON(r.Context(), w, status, value)
	})
}
func (a *Router) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(r.Context().Err(), context.Canceled) && errors.Is(err, context.Canceled) {
		logging.Expected(r.Context())
		return
	}
	var failure *Error
	if !errors.As(err, &failure) && a.mapError != nil {
		failure = a.mapError(err)
	}
	if failure == nil {
		failure = Internal("resource_error").WithCause(err)
	}
	if failure.Status >= 500 && !logging.Diagnosed(r.Context()) {
		var safe []slog.Attr
		for _, attr := range logging.ErrorAttrs(err) {
			if attr.Key != "error_message" {
				safe = append(safe, attr)
			}
		}
		logging.Diagnostic(r.Context(), slog.Default(), slog.LevelError, "web.handler.failed", nil, safe...)
	}
	body := Body(r.Context(), failure.Code, failure.Message)
	if failure.References != nil {
		body["references"] = failure.References
	}
	JSON(r.Context(), w, failure.Status, map[string]any{"error": body})
}
