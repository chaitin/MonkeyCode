package entx

import "context"

type taskConcurrencyLimitKey struct{}

func WithTaskConcurrencyLimit(parent context.Context, limit int) context.Context {
	return context.WithValue(parent, taskConcurrencyLimitKey{}, limit)
}

func TaskConcurrencyLimitFromContext(ctx context.Context) (int, bool) {
	limit, ok := ctx.Value(taskConcurrencyLimitKey{}).(int)
	return limit, ok
}
