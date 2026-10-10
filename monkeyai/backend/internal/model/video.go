package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
)

func marshalVideoFields(item Model) ([]byte, []byte, error) {
	var config, pricing []byte
	var err error
	if item.VideoConfig != nil {
		config, err = json.Marshal(item.VideoConfig)
		if err != nil {
			return nil, nil, err
		}
	}
	if item.VideoPricing != nil {
		pricing, err = json.Marshal(item.VideoPricing)
		if err != nil {
			return nil, nil, err
		}
	}
	return config, pricing, nil
}

func videoValues(values ...any) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, _ := json.Marshal(value)
		result = append(result, data)
	}
	return result
}

func VideoCapabilitiesFor(provider Provider, modelID string) (VideoCapabilities, error) {
	const maxImageBytes = 10 << 20
	first := VideoReferenceSpec{Role: "first_frame", MediaType: "image", MaxCount: 1, MIME: []string{"image/png", "image/jpeg"}, MaxBytes: maxImageBytes}
	last := first
	last.Role = "last_frame"
	reference := first
	reference.Role = "reference_image"
	modes := []VideoMode{VideoTextToVideo, VideoImageToVideo, VideoLastFrameToVideo, VideoFirstLastToVideo, VideoReferenceImageToVideo}
	cap := VideoCapabilities{PromptMaxCharacters: 2000}
	switch {
	case provider == ProviderXAI && modelID == "grok-imagine-video-1.5":
		cap.Modes = []VideoMode{VideoTextToVideo, VideoImageToVideo, VideoReferenceImageToVideo}
		cap.Params = []VideoParamSpec{
			{Name: "resolution", Type: "string", Choices: videoValues("480p", "720p", "1080p")},
			{Name: "aspect_ratio", Type: "string", Choices: videoValues("adaptive", "16:9", "9:16")},
			{Name: "duration_seconds", Type: "integer", Min: videoInt(1), Max: videoInt(15), Step: videoInt(1)},
		}
		cap.ParamRules = []VideoParamRule{
			{When: VideoCondition{Modes: []VideoMode{VideoTextToVideo, VideoReferenceImageToVideo}}, Name: "aspect_ratio", Choices: videoValues("16:9", "9:16")},
			{When: VideoCondition{Modes: []VideoMode{VideoImageToVideo}}, Name: "aspect_ratio", Choices: videoValues("adaptive")},
			{When: VideoCondition{Modes: []VideoMode{VideoReferenceImageToVideo}}, Name: "resolution", Choices: videoValues("480p", "720p")},
		}
		reference.MaxCount = 7
		cap.References = []VideoReferenceSpec{first, reference}
		cap.ReferenceModes = []VideoModeReferences{
			{Mode: VideoTextToVideo, RequiredRoles: []string{}, OptionalRoles: []string{}},
			{Mode: VideoImageToVideo, RequiredRoles: []string{"first_frame"}, OptionalRoles: []string{}},
			{Mode: VideoReferenceImageToVideo, RequiredRoles: []string{"reference_image"}, OptionalRoles: []string{}},
		}
		cap.PromptRequiredWhen = []VideoCondition{{Modes: []VideoMode{VideoTextToVideo, VideoReferenceImageToVideo}}}
	case provider == ProviderMiniMax && modelID == "MiniMax-H3":
		cap.Modes = modes
		cap.Params = []VideoParamSpec{
			{Name: "resolution", Type: "string", Choices: videoValues("768P", "2K")},
			{Name: "aspect_ratio", Type: "string", Choices: videoValues("adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16")},
			{Name: "duration_seconds", Type: "integer", Min: videoInt(4), Max: videoInt(15), Step: videoInt(1)},
		}
		cap.ParamRules = []VideoParamRule{
			{When: VideoCondition{Modes: []VideoMode{VideoTextToVideo}}, Name: "aspect_ratio", Choices: videoValues("21:9", "16:9", "4:3", "1:1", "3:4", "9:16")},
			{When: VideoCondition{Modes: []VideoMode{VideoImageToVideo, VideoLastFrameToVideo, VideoFirstLastToVideo}}, Name: "aspect_ratio", Choices: videoValues("adaptive")},
		}
		first.MinWidth, first.MaxWidth, first.MinHeight, first.MaxHeight = 256, 5760, 256, 5760
		first.MinAspectRatio, first.MaxAspectRatio = "0.4", "2.5"
		last = first
		last.Role = "last_frame"
		reference = first
		reference.Role, reference.MaxCount = "reference_image", 9
		reference.MinAspectRatio, reference.MaxAspectRatio = "", ""
		cap.References = []VideoReferenceSpec{first, last, reference}
		cap.ReferenceModes = []VideoModeReferences{
			{Mode: VideoTextToVideo, RequiredRoles: []string{}, OptionalRoles: []string{}},
			{Mode: VideoImageToVideo, RequiredRoles: []string{"first_frame"}, OptionalRoles: []string{}},
			{Mode: VideoLastFrameToVideo, RequiredRoles: []string{"last_frame"}, OptionalRoles: []string{}},
			{Mode: VideoFirstLastToVideo, RequiredRoles: []string{"first_frame", "last_frame"}, OptionalRoles: []string{}},
			{Mode: VideoReferenceImageToVideo, RequiredRoles: []string{"reference_image"}, OptionalRoles: []string{}},
		}
		cap.PromptRequiredWhen = []VideoCondition{{Modes: modes}}
	default:
		return VideoCapabilities{}, errors.New("视频模型供应商或型号不受支持")
	}
	return cap, nil
}

func videoInt(value int64) *int64 { return &value }

func (s *Service) validateVideoCapability(item Model) error {
	if item.Kind != KindVideo {
		return nil
	}
	cap, err := VideoCapabilitiesFor(item.Provider, item.ModelID)
	if err != nil {
		return err
	}
	return ValidateVideoCapabilities(item, cap)
}

func userVideoPricing(kind Kind, provider Provider, modelID string, config *VideoConfig) *VideoPricing {
	if kind != KindVideo || config == nil {
		return nil
	}
	cap, err := VideoCapabilitiesFor(provider, modelID)
	if err != nil {
		return nil
	}
	pricing := &VideoPricing{Rates: []VideoResolutionRate{}}
	for _, value := range cap.Params[0].Choices {
		for _, mode := range config.Modes {
			defaults := make(map[string]json.RawMessage, len(config.Defaults[mode]))
			for name, entry := range config.Defaults[mode] {
				defaults[name] = entry
			}
			defaults["resolution"] = value
			if _, err := NormalizeVideoParams(config, cap, mode, defaults); err == nil {
				pricing.Rates = append(pricing.Rates, VideoResolutionRate{Resolution: VideoResolution(defaults), CreditsPerSecond: "0"})
				break
			}
		}
	}
	return pricing
}

func validateVideoModel(item *Model) error {
	if item.Protocol != ProtocolVideo || item.AdvancedConfig != (AdvancedConfig{}) ||
		item.ImageConfig != nil || item.ImagePricing != nil || item.VideoConfig == nil || item.VideoPricing == nil ||
		(item.CreditMultiplier != 0 && item.CreditMultiplier != 1) {
		return errors.New("视频模型协议或配置无效")
	}
	if len(item.ProviderOptions) > 0 {
		var options map[string]json.RawMessage
		if json.Unmarshal(item.ProviderOptions, &options) != nil || options == nil {
			return errors.New("provider_options 必须是 JSON 对象")
		}
	}
	item.CreditMultiplier = 1
	cap, err := VideoCapabilitiesFor(item.Provider, item.ModelID)
	if err != nil {
		return err
	}
	return ValidateVideoCapabilities(*item, cap)
}

func ValidateVideoCapabilities(item Model, cap VideoCapabilities) error {
	if item.VideoConfig == nil || item.VideoPricing == nil || len(item.VideoConfig.Modes) == 0 || len(item.VideoConfig.Modes) > len(cap.Modes) {
		return errors.New("视频模型能力配置无效")
	}
	seen := make(map[VideoMode]bool, len(item.VideoConfig.Modes))
	resolutions := map[string]bool{}
	for _, mode := range item.VideoConfig.Modes {
		if seen[mode] || !slices.Contains(cap.Modes, mode) {
			return errors.New("视频模式不受支持或重复")
		}
		seen[mode] = true
		values, ok := item.VideoConfig.Defaults[mode]
		if !ok {
			return errors.New("视频模式缺少默认参数")
		}
		if _, err := NormalizeVideoParams(item.VideoConfig, cap, mode, values); err != nil {
			return fmt.Errorf("视频模式默认参数无效: %w", err)
		}
	}
	if len(item.VideoConfig.Defaults) != len(seen) {
		return errors.New("视频默认值包含未开放模式")
	}
	for mode, limits := range item.VideoConfig.Limits {
		if !seen[mode] {
			return errors.New("参数限制包含未开放模式")
		}
		for name, limit := range limits {
			var spec *VideoParamSpec
			for index := range cap.Params {
				if cap.Params[index].Name == name {
					spec = &cap.Params[index]
					break
				}
			}
			if spec == nil || len(limit.Choices) == 0 && limit.Min == nil && limit.Max == nil && limit.Step == nil {
				return errors.New("视频参数限制无效")
			}
			if limit.Min != nil && (spec.Min == nil || *limit.Min < *spec.Min) || limit.Max != nil && (spec.Max == nil || *limit.Max > *spec.Max) ||
				limit.Step != nil && (*limit.Step <= 0 || spec.Step == nil || *limit.Step%*spec.Step != 0) ||
				limit.Min != nil && limit.Max != nil && *limit.Min > *limit.Max {
				return errors.New("视频参数范围超出供应商能力")
			}
			for _, choice := range limit.Choices {
				if !validVideoValue(*spec, choice) {
					return errors.New("视频参数选项超出供应商能力")
				}
			}
		}
	}
	resolutionSpec := cap.Params[0]
	for _, value := range resolutionSpec.Choices {
		var resolution string
		if json.Unmarshal(value, &resolution) != nil {
			continue
		}
		for _, mode := range item.VideoConfig.Modes {
			values := make(map[string]json.RawMessage, len(item.VideoConfig.Defaults[mode]))
			for name, raw := range item.VideoConfig.Defaults[mode] {
				values[name] = raw
			}
			values["resolution"] = value
			if _, err := NormalizeVideoParams(item.VideoConfig, cap, mode, values); err == nil {
				resolutions[resolution] = true
			}
		}
	}
	if len(item.VideoPricing.Rates) != len(resolutions) {
		return errors.New("视频积分必须覆盖全部开放清晰度")
	}
	for _, entry := range item.VideoPricing.Rates {
		amount, err := billing.ParseAmount(entry.CreditsPerSecond)
		if !resolutions[entry.Resolution] || err != nil || amount < 0 {
			return errors.New("视频清晰度或每秒积分无效")
		}
		delete(resolutions, entry.Resolution)
	}
	return nil
}

func NormalizeVideoParams(config *VideoConfig, cap VideoCapabilities, mode VideoMode, provided map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	if config == nil || !slices.Contains(config.Modes, mode) || !slices.Contains(cap.Modes, mode) {
		return nil, errors.New("视频模式不可用")
	}
	values := make(map[string]json.RawMessage, len(cap.Params))
	for name, value := range config.Defaults[mode] {
		values[name] = value
	}
	for name, value := range provided {
		values[name] = value
	}
	if len(values) != len(cap.Params) {
		return nil, errors.New("视频参数缺失或未声明")
	}
	for _, spec := range cap.Params {
		value, ok := values[spec.Name]
		if !ok || !validVideoValue(spec, value) {
			return nil, fmt.Errorf("参数 %s 不受支持", spec.Name)
		}
		for _, rule := range cap.ParamRules {
			if rule.Name != spec.Name || !videoCondition(rule.When, mode, values) {
				continue
			}
			if len(rule.Choices) > 0 && !rawContains(rule.Choices, value) {
				return nil, fmt.Errorf("参数 %s 不满足模式限制", spec.Name)
			}
			if rule.Min != nil || rule.Max != nil || rule.Step != nil {
				var number int64
				if json.Unmarshal(value, &number) != nil || rule.Min != nil && number < *rule.Min ||
					rule.Max != nil && number > *rule.Max || rule.Step != nil && (*rule.Step <= 0 || number%*rule.Step != 0) {
					return nil, fmt.Errorf("参数 %s 不满足模式范围", spec.Name)
				}
			}
		}
		if limit, ok := config.Limits[mode][spec.Name]; ok {
			if len(limit.Choices) > 0 && !rawContains(limit.Choices, value) {
				return nil, fmt.Errorf("参数 %s 不属于开放选项", spec.Name)
			}
			var number int64
			if limit.Min != nil || limit.Max != nil || limit.Step != nil {
				if json.Unmarshal(value, &number) != nil || limit.Min != nil && number < *limit.Min ||
					limit.Max != nil && number > *limit.Max || limit.Step != nil && number%*limit.Step != 0 {
					return nil, fmt.Errorf("参数 %s 超出开放范围", spec.Name)
				}
			}
		}
	}
	return values, nil
}

func validVideoValue(spec VideoParamSpec, raw json.RawMessage) bool {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return false
	}
	switch spec.Type {
	case "string":
		var value string
		return json.Unmarshal(raw, &value) == nil && rawContains(spec.Choices, raw)
	case "integer":
		var value int64
		if json.Unmarshal(raw, &value) != nil || spec.Min != nil && value < *spec.Min || spec.Max != nil && value > *spec.Max {
			return false
		}
		return spec.Step == nil || value%*spec.Step == 0
	case "boolean":
		var value bool
		return json.Unmarshal(raw, &value) == nil && (len(spec.Choices) == 0 || rawContains(spec.Choices, raw))
	}
	return false
}

func rawContains(values []json.RawMessage, target json.RawMessage) bool {
	var decoded any
	if json.Unmarshal(target, &decoded) != nil {
		return false
	}
	for _, value := range values {
		var candidate any
		if json.Unmarshal(value, &candidate) == nil && fmt.Sprint(candidate) == fmt.Sprint(decoded) {
			return true
		}
	}
	return false
}

func videoCondition(condition VideoCondition, mode VideoMode, params map[string]json.RawMessage) bool {
	if len(condition.Modes) > 0 && !slices.Contains(condition.Modes, mode) {
		return false
	}
	for name, expected := range condition.ParamEquals {
		if !rawContains([]json.RawMessage{expected}, params[name]) {
			return false
		}
	}
	return true
}

func VideoPromptRequired(cap VideoCapabilities, mode VideoMode, values map[string]json.RawMessage) bool {
	for _, condition := range cap.PromptRequiredWhen {
		if videoCondition(condition, mode, values) {
			return true
		}
	}
	return false
}

func VideoRateFor(pricing *VideoPricing, resolution string) (billing.Amount, error) {
	if pricing == nil {
		return 0, errors.New("视频积分未配置")
	}
	for _, entry := range pricing.Rates {
		if entry.Resolution == resolution {
			return billing.ParseAmount(entry.CreditsPerSecond)
		}
	}
	return 0, errors.New("清晰度未配置积分")
}

func VideoDuration(values map[string]json.RawMessage) (int64, error) {
	var seconds int64
	if err := json.Unmarshal(values["duration_seconds"], &seconds); err != nil || seconds < 1 || seconds > 15 {
		return 0, errors.New("视频时长无效")
	}
	return seconds, nil
}

func VideoResolution(values map[string]json.RawMessage) string {
	value, _ := strconv.Unquote(strings.TrimSpace(string(values["resolution"])))
	return value
}
