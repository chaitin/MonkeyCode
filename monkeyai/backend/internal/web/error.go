package web

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web/internal/i18n"
)

type Error struct {
	Status     int    `json:"-"`
	Code       string `json:"code"`
	Message    string `json:"-"`
	References any    `json:"-"`
	Cause      error  `json:"-"`
}

func (e *Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return i18n.Text(context.Background(), e.Code, "")
}
func (e *Error) Unwrap() error                        { return e.Cause }
func (e *Error) WithCause(cause error) *Error         { e.Cause = cause; return e }
func (e *Error) WithReferences(references any) *Error { e.References = references; return e }
func BadRequest(code string) *Error                   { return &Error{Status: http.StatusBadRequest, Code: code} }
func Internal(code string) *Error                     { return &Error{Status: http.StatusInternalServerError, Code: code} }
