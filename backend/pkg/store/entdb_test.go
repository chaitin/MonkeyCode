package store

import (
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/golang-migrate/migrate/v4"
)

type migrateFunc func() error

func (f migrateFunc) Up() error {
	return f()
}

func TestRunMigrationIgnoresNoChange(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	err := runMigration(migrateFunc(func() error {
		return migrate.ErrNoChange
	}), logger)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRunMigrationReturnsUpError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	wantErr := errors.New("migration failed")

	err := runMigration(migrateFunc(func() error {
		return wantErr
	}), logger)

	if !errors.Is(err, wantErr) {
		t.Fatalf("expected %v, got %v", wantErr, err)
	}
}
