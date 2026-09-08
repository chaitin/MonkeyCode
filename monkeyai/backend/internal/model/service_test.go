package model

import (
	"context"
	"errors"
	"testing"
)

type repositoryStub struct {
	models []Model
}

func (r *repositoryStub) List(context.Context, string) ([]Model, error) { return r.models, nil }
func (r *repositoryStub) Get(_ context.Context, id string) (Model, error) {
	for _, item := range r.models {
		if item.ID == id {
			return item, nil
		}
	}
	return Model{}, ErrNotFound
}
func (r *repositoryStub) Create(_ context.Context, item Model) (Model, error) {
	item.ID = "model-1"
	r.models = append(r.models, item)
	return item, nil
}
func (r *repositoryStub) Update(_ context.Context, item Model) (Model, error) {
	return item, nil
}
func (r *repositoryStub) SetEnabled(_ context.Context, id string, enabled bool) (Model, error) {
	item, err := r.Get(context.Background(), id)
	item.Enabled = enabled
	return item, err
}
func (r *repositoryStub) Delete(context.Context, string) error { return nil }
func (r *repositoryStub) ListAvailable(context.Context, string, bool) ([]Model, error) {
	return r.models, nil
}
func (r *repositoryStub) Resolve(ctx context.Context, userID, id string) (Model, error) {
	return r.Get(ctx, id)
}
func (r *repositoryStub) Subjects(context.Context) (Subjects, error) { return Subjects{}, nil }

func validInput() SaveInput {
	return SaveInput{
		ModelID:     "gpt-5",
		DisplayName: "GPT-5",
		Protocol:    ProtocolOpenAIResponses,
		BaseURL:     "https://api.openai.com/v1/",
		APIKey:      "secret",
		AdvancedConfig: AdvancedConfig{
			ContextWindowTokens: 400000,
			MaxOutputTokens:     128000,
			SupportsVision:      true,
		},
		CreditMultiplier: 1,
		Authorization:    Authorization{UserIDs: []string{"user-1"}},
	}
}

func TestCreateModel(t *testing.T) {
	repository := &repositoryStub{}
	service := NewService(repository)
	item, err := service.Create(t.Context(), "admin-1", validInput())
	if err != nil {
		t.Fatal(err)
	}
	if item.ID != "model-1" || item.OwnershipType != "system" || item.OwnerUserID != "admin-1" || !item.Enabled {
		t.Fatalf("model = %#v", item)
	}
	if item.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("base_url = %q", item.BaseURL)
	}
}

func TestModelValidation(t *testing.T) {
	service := NewService(&repositoryStub{})
	tests := []func(*SaveInput){
		func(input *SaveInput) { input.APIKey = "" },
		func(input *SaveInput) { input.Protocol = "unknown" },
		func(input *SaveInput) { input.BaseURL = "file:///tmp/model" },
		func(input *SaveInput) { input.AdvancedConfig.MaxOutputTokens = 0 },
		func(input *SaveInput) { input.CreditMultiplier = 0 },
		func(input *SaveInput) { input.Authorization = Authorization{} },
	}
	for _, change := range tests {
		input := validInput()
		change(&input)
		if _, err := service.Create(t.Context(), "admin-1", input); err == nil {
			t.Fatalf("input %#v should fail", input)
		}
	}
}

func TestCreateModelAllUsers(t *testing.T) {
	input := validInput()
	input.Authorization = Authorization{AllUsers: true}
	item, err := NewService(&repositoryStub{}).Create(t.Context(), "admin-1", input)
	if err != nil || !item.Authorization.AllUsers {
		t.Fatalf("全员授权未保留: %+v, %v", item.Authorization, err)
	}
}

type keyAuthenticatorStub struct {
	userID string
	err    error
}

func (s keyAuthenticatorStub) Authenticate(context.Context, string, string) (string, error) {
	return s.userID, s.err
}

func TestResolveUsesAPIKeyIdentity(t *testing.T) {
	repository := &repositoryStub{models: []Model{{ID: "model-1", ModelID: "gpt-5", Protocol: ProtocolOpenAIResponses, APIKey: "upstream"}}}
	service := NewService(repository).WithKeyAuthenticator(keyAuthenticatorStub{userID: "user-1"})
	target, err := service.Resolve(t.Context(), "mk_key", "model-1")
	if err != nil {
		t.Fatal(err)
	}
	if target.UserID != "user-1" || target.UpstreamModelID != "gpt-5" || target.APIKey != "upstream" {
		t.Fatalf("target = %#v", target)
	}
	service.WithKeyAuthenticator(keyAuthenticatorStub{err: errors.New("invalid")})
	if _, err := service.Resolve(t.Context(), "bad", "model-1"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("error = %v", err)
	}
}

func (r *repositoryStub) UpdateUser(_ context.Context, item Model) (Model, error) { return item, nil }
func (r *repositoryStub) DeleteUser(context.Context, string, string) error        { return nil }
