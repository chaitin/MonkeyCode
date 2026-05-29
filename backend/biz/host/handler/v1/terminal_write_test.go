package v1

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type failingTerminalWriter struct{}

func (failingTerminalWriter) WriteJSON(any) error {
	return errors.New("broken pipe")
}

func TestWriteTerminalMessageCancelsOnFrontendWriteError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ok := writeTerminalMessage(
		ctx,
		cancel,
		failingTerminalWriter{},
		domain.VMTerminalMessage{Type: domain.VMTerminalMessageTypeData},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if ok {
		t.Fatal("writeTerminalMessage returned true, want false")
	}
	if ctx.Err() == nil {
		t.Fatal("context was not canceled after frontend write failure")
	}
}
