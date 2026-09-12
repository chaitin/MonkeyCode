// Package auditmeta carries sanitized operation metadata from usecases to the
// audit middleware without putting scanner responses or package bodies in the
// request context.
package auditmeta

import (
	"context"
	"sync"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type collectorKey struct{}

// GuardResult is the minimal scanner outcome safe to persist in audit logs.
type GuardResult struct {
	TaskID          string
	Status          string
	DetectionResult string
	TraceID         string
}

// Collector is installed by the audit middleware before the handler runs.
// Usecases populate it through SetGuardResult even when the scanner rejects the
// request, so failed attempts can be audited.
type Collector struct {
	mu     sync.Mutex
	result *GuardResult
}

// WithCollector attaches a collector to the request context.
func WithCollector(ctx context.Context, collector *Collector) context.Context {
	if collector == nil {
		return ctx
	}
	return context.WithValue(ctx, collectorKey{}, collector)
}

// SetGuardResult records a sanitized scanner result for the current request.
func SetGuardResult(ctx context.Context, result *domain.SkillGuardResult) {
	if result == nil {
		return
	}
	collector, _ := ctx.Value(collectorKey{}).(*Collector)
	if collector == nil {
		return
	}
	collector.mu.Lock()
	defer collector.mu.Unlock()
	collector.result = &GuardResult{
		TaskID:          result.TaskID,
		Status:          result.Status,
		DetectionResult: result.DetectionResult,
		TraceID:         result.TraceID,
	}
}

// GuardResult returns a copy of the recorded scanner result.
func (c *Collector) GuardResult() (GuardResult, bool) {
	if c == nil {
		return GuardResult{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.result == nil {
		return GuardResult{}, false
	}
	return *c.result, true
}
