//go:build linux || darwin

package control

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestSharedLockContentionWaitsOrCancels(t *testing.T) {
	p := filepath.Join(t.TempDir(), "shared")
	unlock, err := Lock(p)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err = WaitLock(ctx, p)
	unlock()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	release, err := WaitLock(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	release()
}
