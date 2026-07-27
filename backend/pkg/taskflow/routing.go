package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type ConnectionCapability string

const (
	CapabilityOrchestrator ConnectionCapability = "orchestrator"
	CapabilityAgent        ConnectionCapability = "agent"
	CapabilityFileManager  ConnectionCapability = "filemanager"
	CapabilityTask         ConnectionCapability = "task"
	CapabilityTerminal     ConnectionCapability = "terminal"
)

type ErrorCode string

const (
	ErrorInvalidRoute        ErrorCode = "INVALID_ROUTE"
	ErrorOwnerNotFound       ErrorCode = "OWNER_NOT_FOUND"
	ErrorOwnerChanged        ErrorCode = "OWNER_CHANGED"
	ErrorOwnerUnavailable    ErrorCode = "OWNER_UNAVAILABLE"
	ErrorRegistryUnavailable ErrorCode = "REGISTRY_UNAVAILABLE"
	ErrorNodeDraining        ErrorCode = "NODE_DRAINING"
	ErrorRequestProcessing   ErrorCode = "REQUEST_PROCESSING"
	ErrorRequestNotFound     ErrorCode = "REQUEST_NOT_FOUND"
	ErrorResultUnknown       ErrorCode = "RESULT_UNKNOWN"
	ErrorResultNotCached     ErrorCode = "RESULT_NOT_CACHED"
	ErrorStreamNotFound      ErrorCode = "STREAM_NOT_FOUND"
	ErrorRequestConflict     ErrorCode = "REQUEST_CONFLICT"
)

const (
	HeaderRouteCapability = "X-Taskflow-Capability"
	HeaderRouteTargetID   = "X-Taskflow-Target-Id"
	HeaderRequestID       = "X-Taskflow-Request-Id"
	HeaderRequestScope    = "X-Taskflow-Request-Scope"
)

type ExecutionState string

const (
	ExecutionNotDispatched ExecutionState = "not_dispatched"
	ExecutionDispatched    ExecutionState = "dispatched"
	ExecutionUnknown       ExecutionState = "unknown"
)

type TaskflowError struct {
	Code           ErrorCode      `json:"code"`
	Message        string         `json:"message"`
	Retryable      bool           `json:"retryable"`
	ExecutionState ExecutionState `json:"execution_state"`
	RequestID      string         `json:"request_id,omitempty"`
}

func (e *TaskflowError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message == "" {
		return string(e.Code)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *TaskflowError) CanAutoRetry() bool {
	return e != nil && e.Retryable && e.ExecutionState == ExecutionNotDispatched
}

type requestFenceContextKey struct{}

type requestFenceMetadata struct {
	scope     string
	requestID string
}

func WithRequestFence(ctx context.Context, scope, requestID string) context.Context {
	return context.WithValue(ctx, requestFenceContextKey{}, requestFenceMetadata{
		scope:     strings.TrimSpace(scope),
		requestID: strings.TrimSpace(requestID),
	})
}

func routeOption(capability ConnectionCapability, targetID string) request.Opt {
	return request.WithHeader(request.Header{
		HeaderRouteCapability: string(capability),
		HeaderRouteTargetID:   targetID,
	})
}

func fencedRouteOption(ctx context.Context, capability ConnectionCapability, targetID string) request.Opt {
	header := request.Header{
		HeaderRouteCapability: string(capability),
		HeaderRouteTargetID:   targetID,
	}
	if metadata, ok := requestFenceFromContext(ctx); ok {
		header[HeaderRequestScope] = metadata.scope
		header[HeaderRequestID] = metadata.requestID
	}
	return request.WithHeader(header)
}

func requestFenceFromContext(ctx context.Context) (requestFenceMetadata, bool) {
	if ctx == nil {
		return requestFenceMetadata{}, false
	}
	metadata, ok := ctx.Value(requestFenceContextKey{}).(requestFenceMetadata)
	return metadata, ok && metadata.scope != "" && metadata.requestID != ""
}

func ensureRequestFence(ctx context.Context, scope, requestID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, ok := requestFenceFromContext(ctx); ok {
		return ctx
	}
	if strings.TrimSpace(scope) == "" {
		scope = "backend"
	}
	if strings.TrimSpace(requestID) == "" {
		requestID = uuid.NewString()
	}
	return WithRequestFence(ctx, scope, requestID)
}

func targetScope(kind, targetID string) string {
	if strings.TrimSpace(targetID) == "" {
		return "backend"
	}
	return kind + ":" + targetID
}

func parseTaskflowError(err error) error {
	if err == nil {
		return nil
	}
	var protocolErr *TaskflowError
	if errors.As(err, &protocolErr) {
		return protocolErr
	}
	var httpErr *request.HTTPError
	if !errors.As(err, &httpErr) {
		return err
	}
	if json.Unmarshal(httpErr.Body, &protocolErr) == nil && protocolErr != nil && protocolErr.Code != "" {
		return protocolErr
	}
	return err
}

func parseWebsocketError(response *http.Response, err error) error {
	if response == nil || response.Body == nil {
		return err
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return err
	}
	var protocolErr TaskflowError
	if json.Unmarshal(body, &protocolErr) == nil && protocolErr.Code != "" {
		return &protocolErr
	}
	return err
}

func executeMutation[T any](
	ctx context.Context,
	scope string,
	requestID string,
	fn func(context.Context) (T, error),
) (T, error) {
	ctx = ensureRequestFence(ctx, scope, requestID)
	var zero T
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		value, err := fn(ctx)
		if err == nil {
			return value, nil
		}
		err = parseTaskflowError(err)
		lastErr = err
		var protocolErr *TaskflowError
		if attempt > 0 || !errors.As(err, &protocolErr) || !protocolErr.CanAutoRetry() {
			return zero, err
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return zero, ctx.Err()
		case <-timer.C:
		}
	}
	return zero, lastErr
}

func executeMutationError(
	ctx context.Context,
	scope string,
	requestID string,
	fn func(context.Context) error,
) error {
	_, err := executeMutation(ctx, scope, requestID, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, fn(ctx)
	})
	return err
}
