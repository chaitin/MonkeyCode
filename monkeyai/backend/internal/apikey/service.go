package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
)

const (
	defaultExpiryDays = 90
	maxExpiryDays     = 365
	keyPrefixLength   = 11
)

var (
	ErrInvalidKey = errors.New("调用密钥无效或已过期")
	ErrNotFound   = errors.New("调用密钥不存在")
)

type Store interface {
	Create(context.Context, Key, string) (Key, error)
	ListByUser(context.Context, string) ([]Key, error)
	List(context.Context, string) ([]Key, error)
	Revoke(context.Context, string, string) error
	Authenticate(context.Context, string, string) (string, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) Create(ctx context.Context, userID string, input CreateInput) (CreatedKey, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return CreatedKey{}, errors.New("name 不能为空")
	}
	if len(input.Scopes) == 0 {
		input.Scopes = []string{ScopeModelInvoke}
	}
	input.Scopes = uniqueStrings(input.Scopes)
	for _, scope := range input.Scopes {
		if !slices.Contains([]string{ScopeModelInvoke, ScopeMCPInvoke}, scope) {
			return CreatedKey{}, fmt.Errorf("不支持 scope %q", scope)
		}
	}
	if input.ExpiresInDays == 0 {
		input.ExpiresInDays = defaultExpiryDays
	}
	if input.ExpiresInDays < 1 || input.ExpiresInDays > maxExpiryDays {
		return CreatedKey{}, fmt.Errorf("expires_in_days 必须在 1 到 %d 之间", maxExpiryDays)
	}

	raw, err := newSecret()
	if err != nil {
		return CreatedKey{}, fmt.Errorf("生成调用密钥: %w", err)
	}
	now := s.now()
	key := Key{
		UserID:    userID,
		Name:      input.Name,
		Prefix:    raw[:keyPrefixLength],
		Scopes:    input.Scopes,
		ExpiresAt: now.AddDate(0, 0, input.ExpiresInDays),
	}
	stored, err := s.store.Create(ctx, key, hash(raw))
	if err != nil {
		slog.ErrorContext(ctx, "保存调用密钥失败", "user_id", userID, "error", err)
		return CreatedKey{}, err
	}
	return CreatedKey{Key: stored, APIKey: raw}, nil
}

func (s *Service) Rotate(ctx context.Context, userID, id string) (CreatedKey, error) {
	keys, err := s.store.ListByUser(ctx, userID)
	if err != nil {
		return CreatedKey{}, err
	}
	var current *Key
	for index := range keys {
		if keys[index].ID == id && keys[index].RevokedAt == nil {
			current = &keys[index]
			break
		}
	}
	if current == nil {
		return CreatedKey{}, ErrNotFound
	}
	days := int(current.ExpiresAt.Sub(s.now()).Hours() / 24)
	if days < 1 {
		days = defaultExpiryDays
	}
	if days > maxExpiryDays {
		days = maxExpiryDays
	}
	created, err := s.Create(ctx, userID, CreateInput{Name: current.Name, Scopes: current.Scopes, ExpiresInDays: days})
	if err != nil {
		return CreatedKey{}, err
	}
	if err := s.store.Revoke(ctx, id, userID); err != nil {
		if rollbackErr := s.store.Revoke(ctx, created.ID, userID); rollbackErr != nil {
			slog.ErrorContext(ctx, "轮换调用密钥失败后撤销新密钥失败", "key_id", created.ID, "user_id", userID, "error", rollbackErr)
		}
		return CreatedKey{}, err
	}
	return created, nil
}

func (s *Service) ListByUser(ctx context.Context, userID string) ([]Key, error) {
	return s.store.ListByUser(ctx, userID)
}

func (s *Service) AdminList(ctx context.Context, userID string) ([]Key, error) {
	return s.store.List(ctx, userID)
}

func (s *Service) Revoke(ctx context.Context, userID, id string) error {
	return s.store.Revoke(ctx, id, userID)
}

func (s *Service) AdminRevoke(ctx context.Context, id string) error {
	return s.store.Revoke(ctx, id, "")
}

func (s *Service) Authenticate(ctx context.Context, raw, scope string) (string, error) {
	if !strings.HasPrefix(raw, "mk_") {
		return "", ErrInvalidKey
	}
	userID, err := s.store.Authenticate(ctx, hash(raw), scope)
	if err != nil {
		if !errors.Is(err, ErrInvalidKey) {
			slog.ErrorContext(ctx, "验证调用密钥失败", "scope", scope, "error", err)
		}
		return "", ErrInvalidKey
	}
	return userID, nil
}

func newSecret() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "mk_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !slices.Contains(result, value) {
			result = append(result, value)
		}
	}
	slices.Sort(result)
	return result
}
