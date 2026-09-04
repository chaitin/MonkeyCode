package setting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"
)

var Keys = []string{"branding", "authentication", "email", "billing"}

type Record struct {
	Key             string          `json:"key"`
	Value           json.RawMessage `json:"value"`
	SchemaVersion   int             `json:"schema_version"`
	UpdatedByUserID string          `json:"updated_by_user_id"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type Config struct {
	Version   int64                      `json:"version"`
	UpdatedAt time.Time                  `json:"updated_at"`
	Settings  map[string]json.RawMessage `json:"settings"`
}

type Store interface {
	Get(context.Context, string) (Record, error)
	List(context.Context) ([]Record, error)
	Put(context.Context, Record) (Record, error)
}

type Service struct {
	store             Store
	broker            *Broker
	distributedEvents bool
}

func NewService(store Store, broker *Broker) *Service {
	_, distributed := store.(eventListener)
	return &Service{store: store, broker: broker, distributedEvents: distributed}
}

type eventListener interface {
	Listen(context.Context, func(Event)) error
}

func (s *Service) Listen(ctx context.Context) error {
	listener, ok := s.store.(eventListener)
	if !ok {
		<-ctx.Done()
		return ctx.Err()
	}
	return listener.Listen(ctx, s.broker.Publish)
}

func (s *Service) Get(ctx context.Context, key string) (Record, error) {
	if !slices.Contains(Keys, key) {
		return Record{}, ErrUnknownKey
	}
	return s.store.Get(ctx, key)
}

func (s *Service) GetValue(ctx context.Context, key string) (json.RawMessage, error) {
	record, err := s.Get(ctx, key)
	return record.Value, err
}

func (s *Service) List(ctx context.Context) ([]Record, error) {
	return s.store.List(ctx)
}

func (s *Service) Put(ctx context.Context, key string, value json.RawMessage, schemaVersion int, userID string) (Record, error) {
	if !slices.Contains(Keys, key) {
		return Record{}, ErrUnknownKey
	}
	if schemaVersion < 1 {
		return Record{}, errors.New("schema_version 必须大于 0")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(value, &object); err != nil || object == nil {
		return Record{}, errors.New("value 必须是 JSON 对象")
	}
	value, err := s.mergeSecrets(ctx, key, value)
	if err != nil {
		return Record{}, err
	}
	if err := json.Unmarshal(value, &object); err != nil {
		return Record{}, errors.New("value 必须是 JSON 对象")
	}
	if err := validate(key, object); err != nil {
		return Record{}, err
	}

	record, err := s.store.Put(ctx, Record{
		Key:             key,
		Value:           value,
		SchemaVersion:   schemaVersion,
		UpdatedByUserID: userID,
	})
	if err != nil {
		return Record{}, err
	}
	if !s.distributedEvents {
		s.broker.Publish(Event{Key: record.Key, Version: record.UpdatedAt.UnixMilli()})
	}
	return record, nil
}

func (s *Service) AdminGet(ctx context.Context, key string) (Record, error) {
	record, err := s.Get(ctx, key)
	if err != nil {
		return Record{}, err
	}
	record.Value, err = redact(record.Key, record.Value)
	return record, err
}

func (s *Service) AdminList(ctx context.Context) ([]Record, error) {
	records, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	for index := range records {
		records[index].Value, err = redact(records[index].Key, records[index].Value)
		if err != nil {
			return nil, err
		}
	}
	return records, nil
}

func (s *Service) AgentConfig(ctx context.Context) (Config, error) {
	records, err := s.store.List(ctx)
	if err != nil {
		return Config{}, err
	}

	config := Config{Settings: make(map[string]json.RawMessage)}
	for _, record := range records {
		value, err := redact(record.Key, record.Value)
		if err != nil {
			return Config{}, fmt.Errorf("过滤 %s 配置: %w", record.Key, err)
		}
		config.Settings[record.Key] = value
		if record.UpdatedAt.After(config.UpdatedAt) {
			config.UpdatedAt = record.UpdatedAt
		}
	}
	config.Version = config.UpdatedAt.UnixMilli()
	return config, nil
}

func redact(key string, value json.RawMessage) (json.RawMessage, error) {
	var object map[string]any
	if err := json.Unmarshal(value, &object); err != nil {
		return nil, err
	}
	switch key {
	case "authentication":
		connections, _ := object["oauth_connections"].([]any)
		for _, item := range connections {
			if connection, ok := item.(map[string]any); ok {
				delete(connection, "client_secret")
			}
		}
	case "email":
		delete(object, "smtp_password")
	case "billing":
		delete(object, "remote_billing_api_key")
	}
	return json.Marshal(object)
}

func (s *Service) mergeSecrets(ctx context.Context, key string, value json.RawMessage) (json.RawMessage, error) {
	existing, err := s.store.Get(ctx, key)
	if errors.Is(err, ErrNotFound) {
		return value, nil
	}
	if err != nil {
		return nil, err
	}
	var next, previous map[string]any
	if json.Unmarshal(value, &next) != nil || json.Unmarshal(existing.Value, &previous) != nil {
		return value, nil
	}
	switch key {
	case "authentication":
		previousByID := make(map[string]map[string]any)
		for _, item := range anySlice(previous["oauth_connections"]) {
			connection, _ := item.(map[string]any)
			previousByID[stringAny(connection["id"])] = connection
		}
		for _, item := range anySlice(next["oauth_connections"]) {
			connection, _ := item.(map[string]any)
			if stringAny(connection["client_secret"]) == "" {
				connection["client_secret"] = previousByID[stringAny(connection["id"])]["client_secret"]
			}
		}
	case "email":
		if stringAny(next["smtp_password"]) == "" {
			next["smtp_password"] = previous["smtp_password"]
		}
	case "billing":
		if stringAny(next["remote_billing_api_key"]) == "" {
			next["remote_billing_api_key"] = previous["remote_billing_api_key"]
		}
	}
	return json.Marshal(next)
}

func validate(key string, value map[string]json.RawMessage) error {
	switch key {
	case "branding":
		if rawString(value["workspace_name"]) == "" || rawString(value["product_name"]) == "" {
			return errors.New("workspace_name 和 product_name 不能为空")
		}
	case "authentication":
		var connections []struct {
			ID           string `json:"id"`
			Provider     string `json:"provider"`
			Name         string `json:"name"`
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
			IssuerURL    string `json:"issuer_url"`
		}
		if raw, ok := value["oauth_connections"]; ok && json.Unmarshal(raw, &connections) != nil {
			return errors.New("oauth_connections 格式无效")
		}
		seen := make(map[string]bool)
		for _, connection := range connections {
			if connection.ID == "" || seen[connection.ID] || connection.Name == "" || connection.ClientID == "" || connection.ClientSecret == "" {
				return errors.New("OAuth 配置缺少必填字段或 ID 重复")
			}
			seen[connection.ID] = true
			if !slices.Contains([]string{"github", "google", "microsoft", "gitlab", "oidc"}, connection.Provider) {
				return errors.New("OAuth provider 无效")
			}
			if connection.Provider == "oidc" && connection.IssuerURL == "" {
				return errors.New("OIDC issuer_url 不能为空")
			}
		}
	case "email":
		var port int
		if raw, ok := value["smtp_port"]; ok && json.Unmarshal(raw, &port) == nil && (port < 1 || port > 65535) {
			return errors.New("smtp_port 必须在 1 到 65535 之间")
		}
	case "billing":
		cycle := rawString(value["quota_refresh_cycle"])
		mode := rawString(value["charging_mode"])
		if cycle != "" && !slices.Contains([]string{"daily", "weekly", "monthly"}, cycle) {
			return errors.New("quota_refresh_cycle 无效")
		}
		if mode != "" && !slices.Contains([]string{"local", "remote"}, mode) {
			return errors.New("charging_mode 无效")
		}
	}
	return nil
}

func rawString(value json.RawMessage) string {
	var result string
	_ = json.Unmarshal(value, &result)
	return result
}

func anySlice(value any) []any {
	result, _ := value.([]any)
	return result
}

func stringAny(value any) string {
	result, _ := value.(string)
	return result
}

var ErrUnknownKey = errors.New("未知设置域")
