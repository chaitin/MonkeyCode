package apikey

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"
)

type storeStub struct {
	keys      []Key
	hash      string
	userID    string
	authErr   error
	revokeErr map[string]error
	revoked   []string
}

func (s *storeStub) Create(_ context.Context, key Key, hash string) (Key, error) {
	key.ID = fmt.Sprintf("key-%d", len(s.keys)+1)
	key.CreatedAt = time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)
	s.keys = append(s.keys, key)
	s.hash = hash
	return key, nil
}

func (s *storeStub) ListByUser(context.Context, string) ([]Key, error) { return s.keys, nil }
func (s *storeStub) List(context.Context, string) ([]Key, error)       { return s.keys, nil }
func (s *storeStub) Revoke(_ context.Context, id, _ string) error {
	s.revoked = append(s.revoked, id)
	return s.revokeErr[id]
}
func (s *storeStub) Authenticate(context.Context, string, string) (string, error) {
	return s.userID, s.authErr
}

func TestCreateReturnsSecretOnce(t *testing.T) {
	store := &storeStub{}
	service := NewService(store)
	service.now = func() time.Time { return time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC) }

	created, err := service.Create(t.Context(), "user-1", CreateInput{Name: " MacBook ", Scopes: []string{ScopeModelInvoke}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.APIKey, "mk_") || created.Prefix != created.APIKey[:keyPrefixLength] {
		t.Fatalf("key = %#v", created)
	}
	if created.Name != "MacBook" || created.UserID != "user-1" {
		t.Fatalf("metadata = %#v", created.Key)
	}
	if store.hash == "" || strings.Contains(store.hash, created.APIKey) {
		t.Fatalf("hash = %q", store.hash)
	}
	if created.ExpiresAt.Sub(service.now()) != 90*24*time.Hour {
		t.Fatalf("expires_at = %s", created.ExpiresAt)
	}
}

func TestCreateValidatesInput(t *testing.T) {
	service := NewService(&storeStub{})
	tests := []CreateInput{
		{Name: ""},
		{Name: "agent", Scopes: []string{"unknown"}},
		{Name: "agent", ExpiresInDays: 366},
	}
	for _, input := range tests {
		if _, err := service.Create(t.Context(), "user-1", input); err == nil {
			t.Fatalf("input %#v should fail", input)
		}
	}
}

func TestAuthenticateHidesStoreErrors(t *testing.T) {
	store := &storeStub{userID: "user-1"}
	service := NewService(store)
	userID, err := service.Authenticate(t.Context(), "mk_secret", ScopeModelInvoke)
	if err != nil || userID != "user-1" {
		t.Fatalf("authenticate = %q, %v", userID, err)
	}
	store.authErr = errors.New("database unavailable")
	if _, err := service.Authenticate(t.Context(), "mk_secret", ScopeModelInvoke); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("error = %v", err)
	}
}

func TestRotateLogsFailedCompensationWithoutSecret(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	store := &storeStub{
		keys:      []Key{{ID: "key-1", Name: "work", Scopes: []string{ScopeModelInvoke}, ExpiresAt: time.Now().Add(30 * 24 * time.Hour)}},
		revokeErr: map[string]error{"key-1": errors.New("old revoke failed"), "key-2": errors.New("cleanup failed")},
	}
	_, err := NewService(store).Rotate(t.Context(), "user-1", "key-1")
	if err == nil || len(store.revoked) != 2 || store.revoked[0] != "key-1" || store.revoked[1] != "key-2" {
		t.Fatalf("撤销失败后应尝试回收新密钥: %v, %v", store.revoked, err)
	}
	if !strings.Contains(output.String(), "cleanup failed") || !strings.Contains(output.String(), "key-2") || strings.Contains(output.String(), store.hash) {
		t.Fatalf("补偿日志缺少错误或包含密钥摘要: %s", output.String())
	}
}
