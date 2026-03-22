package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Runner struct {
	ID           string           `json:"id"`
	Hostname     string           `json:"hostname"`
	IP           string           `json:"ip"`
	Status       string           `json:"status"`
	LastSeen     int64            `json:"last_seen"`
	Capacity     map[string]int64 `json:"capacity"`
	UserID       string           `json:"user_id"`
}

type VM struct {
	ID          string `json:"id"`
	RunnerID    string `json:"runner_id"`
	UserID      string `json:"user_id"`
	Status      string `json:"status"`
	ContainerID string `json:"container_id"`
	CreatedAt   int64  `json:"created_at"`
}

type Task struct {
	ID        string `json:"id"`
	VMID      string `json:"vm_id"`
	Status    string `json:"status"`
	Agent     string `json:"agent"`
	CreatedAt int64  `json:"created_at"`
}

type RedisStore struct {
	client *redis.Client
}

func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

func (s *RedisStore) RegisterRunner(ctx context.Context, runner *Runner, ttl time.Duration) error {
	data, err := json.Marshal(runner)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("runner:%s", runner.ID)
	return s.client.Set(ctx, key, data, ttl).Err()
}

func (s *RedisStore) GetRunner(ctx context.Context, id string) (*Runner, error) {
	key := fmt.Sprintf("runner:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}

	var runner Runner
	if err := json.Unmarshal(data, &runner); err != nil {
		return nil, err
	}

	return &runner, nil
}

func (s *RedisStore) DeleteRunner(ctx context.Context, id string) error {
	key := fmt.Sprintf("runner:%s", id)
	return s.client.Del(ctx, key).Err()
}

func (s *RedisStore) SetVM(ctx context.Context, vm *VM) error {
	data, err := json.Marshal(vm)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("vm:%s", vm.ID)
	return s.client.Set(ctx, key, data, 0).Err()
}

func (s *RedisStore) GetVM(ctx context.Context, id string) (*VM, error) {
	key := fmt.Sprintf("vm:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}

	var vm VM
	if err := json.Unmarshal(data, &vm); err != nil {
		return nil, err
	}

	return &vm, nil
}

func (s *RedisStore) DeleteVM(ctx context.Context, id string) error {
	key := fmt.Sprintf("vm:%s", id)
	return s.client.Del(ctx, key).Err()
}

func (s *RedisStore) SetTask(ctx context.Context, task *Task) error {
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("task:%s", task.ID)
	return s.client.Set(ctx, key, data, 0).Err()
}

func (s *RedisStore) GetTask(ctx context.Context, id string) (*Task, error) {
	key := fmt.Sprintf("task:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}

	var task Task
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, err
	}

	return &task, nil
}

func (s *RedisStore) DeleteTask(ctx context.Context, id string) error {
	key := fmt.Sprintf("task:%s", id)
	return s.client.Del(ctx, key).Err()
}

func (s *RedisStore) AddUserRunner(ctx context.Context, userID, runnerID string) error {
	key := fmt.Sprintf("user:runners:%s", userID)
	return s.client.SAdd(ctx, key, runnerID).Err()
}

func (s *RedisStore) GetUserRunners(ctx context.Context, userID string) ([]string, error) {
	key := fmt.Sprintf("user:runners:%s", userID)
	return s.client.SMembers(ctx, key).Result()
}

func (s *RedisStore) RemoveUserRunner(ctx context.Context, userID, runnerID string) error {
	key := fmt.Sprintf("user:runners:%s", userID)
	return s.client.SRem(ctx, key, runnerID).Err()
}

func (s *RedisStore) AddUserVM(ctx context.Context, userID, vmID string) error {
	key := fmt.Sprintf("user:vms:%s", userID)
	return s.client.SAdd(ctx, key, vmID).Err()
}

func (s *RedisStore) GetUserVMs(ctx context.Context, userID string) ([]string, error) {
	key := fmt.Sprintf("user:vms:%s", userID)
	return s.client.SMembers(ctx, key).Result()
}

func (s *RedisStore) RemoveUserVM(ctx context.Context, userID, vmID string) error {
	key := fmt.Sprintf("user:vms:%s", userID)
	return s.client.SRem(ctx, key, vmID).Err()
}

func (s *RedisStore) AddUserTask(ctx context.Context, userID, taskID string) error {
	key := fmt.Sprintf("user:tasks:%s", userID)
	return s.client.SAdd(ctx, key, taskID).Err()
}

func (s *RedisStore) GetUserTasks(ctx context.Context, userID string) ([]string, error) {
	key := fmt.Sprintf("user:tasks:%s", userID)
	return s.client.SMembers(ctx, key).Result()
}

func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}
