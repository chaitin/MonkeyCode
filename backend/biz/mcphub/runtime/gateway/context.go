package gateway

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/auth"
)

type contextKey string

const (
	subjectContextKey   contextKey = "mcphub_subject"
	requestIDContextKey contextKey = "mcphub_request_id"
)

func WithSubject(ctx context.Context, subject *auth.Subject) context.Context {
	return context.WithValue(ctx, subjectContextKey, subject)
}

func SubjectFromContext(ctx context.Context) (*auth.Subject, bool) {
	subject, ok := ctx.Value(subjectContextKey).(*auth.Subject)
	return subject, ok && subject != nil
}

func WithRequestID(ctx context.Context, id any) context.Context {
	return context.WithValue(ctx, requestIDContextKey, id)
}

func RequestIDFromContext(ctx context.Context) any {
	return ctx.Value(requestIDContextKey)
}
