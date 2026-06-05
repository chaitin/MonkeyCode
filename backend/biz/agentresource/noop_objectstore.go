package agentresource

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

// noopObjectStore is used when ObjectStorage is disabled in config. Every
// fetch fails with a stable sentinel-ish error so resolver-level warn logs
// stay informative ("skill skipped: object storage disabled") rather than
// crashing with a nil deref.
type noopObjectStore struct{}

func (noopObjectStore) GetObject(_ context.Context, _ string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("object storage disabled")
}

func (noopObjectStore) PresignGet(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", errors.New("object storage disabled")
}
