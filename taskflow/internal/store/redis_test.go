package store

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupTestStore(t *testing.T) (*RedisStore, *miniredis.Miniredis) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}

	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})

	return NewRedisStore(client), mr
}

func TestRunnerStore(t *testing.T) {
	store, mr := setupTestStore(t)
	defer mr.Close()

	ctx := context.Background()

	runner := &Runner{
		ID:       "runner-1",
		Hostname: "test-server",
		IP:       "192.168.1.100",
		Status:   "online",
		LastSeen: time.Now().Unix(),
		Capacity: map[string]int64{
			"cores":  8,
			"memory": 16384,
		},
	}

	err := store.RegisterRunner(ctx, runner, 60*time.Second)
	if err != nil {
		t.Fatalf("RegisterRunner failed: %v", err)
	}

	got, err := store.GetRunner(ctx, "runner-1")
	if err != nil {
		t.Fatalf("GetRunner failed: %v", err)
	}

	if got.ID != runner.ID {
		t.Errorf("expected ID %s, got %s", runner.ID, got.ID)
	}
	if got.Hostname != runner.Hostname {
		t.Errorf("expected Hostname %s, got %s", runner.Hostname, got.Hostname)
	}
}

func TestVMStore(t *testing.T) {
	store, mr := setupTestStore(t)
	defer mr.Close()

	ctx := context.Background()

	vm := &VM{
		ID:          "vm-1",
		RunnerID:    "runner-1",
		UserID:      "user-1",
		Status:      "running",
		ContainerID: "container-123",
		CreatedAt:   time.Now().Unix(),
	}

	err := store.SetVM(ctx, vm)
	if err != nil {
		t.Fatalf("SetVM failed: %v", err)
	}

	got, err := store.GetVM(ctx, "vm-1")
	if err != nil {
		t.Fatalf("GetVM failed: %v", err)
	}

	if got.ID != vm.ID {
		t.Errorf("expected ID %s, got %s", vm.ID, got.ID)
	}
}

func TestUserRelations(t *testing.T) {
	store, mr := setupTestStore(t)
	defer mr.Close()

	ctx := context.Background()
	userID := "user-1"

	err := store.AddUserRunner(ctx, userID, "runner-1")
	if err != nil {
		t.Fatalf("AddUserRunner failed: %v", err)
	}

	runners, err := store.GetUserRunners(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRunners failed: %v", err)
	}

	if len(runners) != 1 {
		t.Errorf("expected 1 runner, got %d", len(runners))
	}
}
