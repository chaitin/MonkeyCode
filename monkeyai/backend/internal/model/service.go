package model

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

var (
	ErrNotFound     = errors.New("模型不存在")
	ErrUnauthorized = errors.New("无权使用该模型")
)

type Repository interface {
	List(context.Context, string) ([]Model, error)
	Get(context.Context, string) (Model, error)
	Create(context.Context, Model) (Model, error)
	Update(context.Context, Model) (Model, error)
	SetEnabled(context.Context, string, bool) (Model, error)
	Delete(context.Context, string) error
	UpdateUser(context.Context, Model) (Model, error)
	DeleteUser(context.Context, string, string) error
	ListAvailable(context.Context, string, bool) ([]Model, error)
	Resolve(context.Context, string, string) (Model, error)
	Subjects(context.Context) (Subjects, error)
}

type KeyAuthenticator interface {
	Authenticate(context.Context, string, string) (string, error)
}

type Service struct {
	repository        Repository
	keys              KeyAuthenticator
	gatewayURL        string
	imageCapabilities func(Provider, string) (ImageCapabilities, error)
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) WithKeyAuthenticator(keys KeyAuthenticator) *Service {
	s.keys = keys
	return s
}

func (s *Service) WithGatewayURL(url string) *Service {
	s.gatewayURL = strings.TrimRight(url, "/")
	return s
}

func (s *Service) WithImageCapabilities(describe func(Provider, string) (ImageCapabilities, error)) *Service {
	s.imageCapabilities = describe
	return s
}

func (s *Service) DescribeImage(provider Provider, modelID string) (ImageCapabilities, error) {
	if s.imageCapabilities == nil {
		return ImageCapabilities{}, errors.New("生图模型能力不可用")
	}
	return s.imageCapabilities(provider, strings.TrimSpace(modelID))
}

func (s *Service) validateImageCapability(item Model) error {
	if item.Kind != KindImage || s.imageCapabilities == nil {
		return nil
	}
	cap, err := s.imageCapabilities(item.Provider, item.ModelID)
	if err != nil {
		return err
	}
	return validateImageCapabilities(item, cap)
}

func validateImageCapabilities(item Model, cap ImageCapabilities) error {
	for _, quality := range item.ImageConfig.Qualities {
		if !slices.Contains(cap.Qualities, quality) {
			return errors.New("画质档位不被上游模型支持")
		}
		for _, ratio := range item.ImageConfig.AspectRatios {
			if !slices.Contains(cap.AspectRatios, ratio) || (cap.AllowedAspectRatios != nil && !slices.Contains(cap.AllowedAspectRatios[quality], ratio)) {
				return errors.New("画质与比例组合不被上游模型支持")
			}
		}
	}
	return nil
}

func (s *Service) List(ctx context.Context, ownership string) ([]Model, error) {
	if ownership != "" && ownership != "system" && ownership != "user" {
		return nil, errors.New("ownership_type 无效")
	}
	return s.repository.List(ctx, ownership)
}

func (s *Service) Create(ctx context.Context, ownerUserID string, input SaveInput) (Model, error) {
	item, err := systemModelFromInput(input)
	if err != nil {
		return Model{}, err
	}
	if item.APIKey == "" {
		return Model{}, errors.New("api_key 不能为空")
	}
	if err := s.validateImageCapability(item); err != nil {
		return Model{}, err
	}
	item.OwnershipType = "system"
	item.OwnerUserID = ownerUserID
	item.GrantorUserID = ownerUserID
	item.Enabled = true
	return s.repository.Create(ctx, item)
}

func (s *Service) Update(ctx context.Context, id, actorUserID string, input SaveInput) (Model, error) {
	existing, err := s.repository.Get(ctx, id)
	if err != nil {
		return Model{}, err
	}
	if existing.OwnershipType != "system" {
		return Model{}, errors.New("个人模型不能由管理员修改")
	}
	item, err := systemModelFromInput(input)
	if err != nil {
		return Model{}, err
	}
	if err := s.validateImageCapability(item); err != nil {
		return Model{}, err
	}
	item.ID = id
	item.OwnershipType = existing.OwnershipType
	item.OwnerUserID = existing.OwnerUserID
	item.GrantorUserID = actorUserID
	item.Enabled = existing.Enabled
	if input.TagIDs == nil {
		item.TagIDs = tagIDs(existing.Tags)
	}
	if item.APIKey == "" {
		item.APIKey = existing.APIKey
	}
	if len(input.ProviderOptions) == 0 {
		item.ProviderOptions = existing.ProviderOptions
	}
	return s.repository.Update(ctx, item)
}

func (s *Service) SetEnabled(ctx context.Context, id string, enabled bool) (Model, error) {
	return s.repository.SetEnabled(ctx, id, enabled)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repository.Delete(ctx, id)
}

func (s *Service) Subjects(ctx context.Context) (Subjects, error) {
	return s.repository.Subjects(ctx)
}

func (s *Service) AgentModels(ctx context.Context, userID string, isAdmin bool) ([]AgentModel, error) {
	models, err := s.repository.ListAvailable(ctx, userID, isAdmin)
	if err != nil {
		return nil, err
	}
	result := make([]AgentModel, 0, len(models))
	for _, item := range models {
		var imageConfig *AgentImageConfig
		if item.Kind == KindImage && item.ImageConfig != nil {
			cap := ImageCapabilities{}
			if s.imageCapabilities != nil {
				cap, err = s.imageCapabilities(item.Provider, item.ModelID)
				if err != nil {
					slog.ErrorContext(ctx, "读取模型生图能力失败", "model_id", item.ID, "error", err)
					continue
				}
				if validateImageCapabilities(item, cap) != nil {
					continue
				}
			}
			imageConfig = &AgentImageConfig{ImageConfig: *item.ImageConfig, ImageCapabilities: cap}
		}
		entry := AgentModel{
			OwnershipType:       item.OwnershipType,
			User:                item.User,
			ID:                  item.ID,
			Model:               item.ModelID + "@" + item.ID,
			DisplayName:         item.DisplayName,
			Protocol:            item.Protocol,
			Kind:                item.Kind,
			ImageConfig:         imageConfig,
			ImagePricing:        item.ImagePricing,
			ContextWindowTokens: item.AdvancedConfig.ContextWindowTokens,
			MaxOutputTokens:     item.AdvancedConfig.MaxOutputTokens,
			SupportsVision:      item.AdvancedConfig.SupportsVision,
			SupportsReasoning:   item.AdvancedConfig.SupportsReasoning,
			CreditMultiplier:    item.CreditMultiplier,
			Tags:                item.Tags,
			UpdatedAt:           item.UpdatedAt,
		}
		if item.OwnershipType == "user" {
			if item.OwnerUserID == userID {
				users := item.SharedUsers
				if users == nil {
					users = []Subject{}
				}
				entry.SharedUsers = &users
			} else {
				entry.Creator = item.Creator
			}
		}
		result = append(result, entry)
	}
	return result, nil
}

func (s *Service) Resolve(ctx context.Context, credential, requestedModel string) (Target, error) {
	if s.keys == nil {
		return Target{}, errors.New("模型解析器未配置")
	}
	userID, err := s.keys.Authenticate(ctx, credential, "model:invoke")
	if err != nil {
		return Target{}, ErrUnauthorized
	}
	item, err := s.repository.Resolve(ctx, userID, requestedModel)
	if err != nil {
		return Target{}, err
	}
	return Target{
		ID:              item.ID,
		UserID:          userID,
		OwnershipType:   item.OwnershipType,
		UpstreamModelID: item.ModelID,
		Protocol:        item.Protocol,
		Kind:            item.Kind,
		Provider:        item.Provider,
		ProviderOptions: item.ProviderOptions,
		BaseURL:         item.BaseURL,
		APIKey:          item.APIKey,
	}, nil
}

func modelFromInput(input SaveInput) (Model, error) {
	kind := input.Kind
	if kind == "" {
		kind = KindText
	}
	provider := input.Provider
	if provider == "" && kind == KindText {
		provider = ProviderPassthrough
	}
	item := Model{
		ModelID:          strings.TrimSpace(input.ModelID),
		DisplayName:      strings.TrimSpace(input.DisplayName),
		Protocol:         input.Protocol,
		Kind:             kind,
		Provider:         provider,
		ProviderOptions:  input.ProviderOptions,
		ImageConfig:      input.ImageConfig,
		ImagePricing:     input.ImagePricing,
		BaseURL:          strings.TrimRight(strings.TrimSpace(input.BaseURL), "/"),
		APIKey:           strings.TrimSpace(input.APIKey),
		AdvancedConfig:   input.AdvancedConfig,
		CreditMultiplier: input.CreditMultiplier,
		Authorization:    normalizeAuthorization(input.Authorization),
		TagIDs:           input.TagIDs,
	}
	if item.ModelID == "" || item.DisplayName == "" || item.BaseURL == "" {
		return Model{}, errors.New("model_id、display_name 和 base_url 不能为空")
	}
	if kind == KindText {
		if !slices.Contains([]Protocol{ProtocolOpenAIChat, ProtocolOpenAIResponses, ProtocolAnthropic}, item.Protocol) || provider != ProviderPassthrough || item.ImageConfig != nil || item.ImagePricing != nil {
			return Model{}, errors.New("文本模型配置无效")
		}
	} else if kind == KindImage {
		if item.Protocol != ProtocolImage {
			return Model{}, errors.New("生图模型 protocol 无效")
		}
		if err := validateImageModel(&item); err != nil {
			return Model{}, err
		}
	} else {
		return Model{}, errors.New("kind 无效")
	}
	parsed, err := url.Parse(item.BaseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return Model{}, errors.New("base_url 必须是有效的 HTTP(S) 地址")
	}
	if kind == KindText && (item.AdvancedConfig.ContextWindowTokens <= 0 || item.AdvancedConfig.MaxOutputTokens <= 0) {
		return Model{}, errors.New("上下文和最大输出 Token 必须大于 0")
	}
	if kind == KindImage && item.CreditMultiplier == 0 {
		item.CreditMultiplier = 1
	}
	if item.CreditMultiplier <= 0 {
		return Model{}, errors.New("credit_multiplier 必须大于 0")
	}
	return item, nil
}

func tagIDs(tags []resource.Object) []string {
	ids := make([]string, 0, len(tags))
	for _, tag := range tags {
		ids = append(ids, tag.String("id"))
	}
	return ids
}

func systemModelFromInput(input SaveInput) (Model, error) {
	item, err := modelFromInput(input)
	if err != nil {
		return Model{}, err
	}
	if !item.Authorization.AllUsers && len(item.Authorization.UserIDs)+len(item.Authorization.GroupIDs) == 0 {
		return Model{}, errors.New("至少需要一个资源访问授权")
	}
	return item, nil
}

func unique(values []string) []string {
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
