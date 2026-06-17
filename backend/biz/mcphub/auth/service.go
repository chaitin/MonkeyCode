package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
	"github.com/chaitin/MonkeyCode/backend/db/taskvirtualmachine"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrTaskNotBound = errors.New("task not bound")
)

type Subject struct {
	Token         string
	UserID        uuid.UUID
	TaskID        uuid.UUID
	ModelID       uuid.UUID
	ModelAPIKeyID uuid.UUID
}

type Service struct {
	db     *db.Client
	logger *slog.Logger
}

func NewService(client *db.Client, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		db:     client,
		logger: logger,
	}
}

func (s *Service) Resolve(ctx context.Context, token string) (*Subject, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrUnauthorized
	}

	key, err := s.db.ModelApiKey.Query().
		Where(modelapikey.APIKey(token)).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) || db.IsNotSingular(err) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("query model api key: %w", err)
	}
	if strings.TrimSpace(key.VirtualmachineID) == "" {
		return nil, ErrTaskNotBound
	}

	tvm, err := s.db.TaskVirtualMachine.Query().
		Where(taskvirtualmachine.VirtualmachineID(key.VirtualmachineID)).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) || db.IsNotSingular(err) {
			return nil, ErrTaskNotBound
		}
		return nil, fmt.Errorf("query task binding: %w", err)
	}

	return &Subject{
		Token:         token,
		UserID:        key.UserID,
		TaskID:        tvm.TaskID,
		ModelID:       key.ModelID,
		ModelAPIKeyID: key.ID,
	}, nil
}
