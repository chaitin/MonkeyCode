package kb

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const (
	SearchModeHybrid  = "hybrid"
	SearchModeLexical = "lexical"

	ChannelLexical = "lexical"
	ChannelVector  = "vector"

	defaultRRFK             = 60
	defaultLexicalWeight    = 0.3
	defaultVectorWeight     = 0.7
	defaultMaxSearchTokens  = 2048
	defaultSearchCandidate  = 50
	defaultSearchResultSize = 8
)

type FusionConfig struct {
	Type    string             `json:"type"`
	K       int                `json:"k"`
	Weights map[string]float64 `json:"weights"`
}

type SearchResponse struct {
	Query         string            `json:"query"`
	RetrievalMode string            `json:"retrieval_mode"`
	ChannelsUsed  []string          `json:"channels_used"`
	Fusion        map[string]any    `json:"fusion"`
	Degraded      bool              `json:"degraded"`
	Warnings      []string          `json:"warnings"`
	Items         []resource.Object `json:"items"`
}

type IndexCapabilities struct {
	SearchModes         []string `json:"search_modes"`
	Channels            []string `json:"channels"`
	EmbeddingConfigured bool     `json:"embedding_configured"`
}

type channelDecision struct {
	mode     string
	channels []string
	degraded bool
	warnings []string
}

func defaultFusionConfig() FusionConfig {
	return FusionConfig{
		Type: "weighted_rrf",
		K:    defaultRRFK,
		Weights: map[string]float64{
			ChannelLexical: defaultLexicalWeight,
			ChannelVector:  defaultVectorWeight,
		},
	}
}

func normalizeFusionConfig(value any) FusionConfig {
	out := defaultFusionConfig()
	if config, ok := value.(FusionConfig); ok {
		if strings.TrimSpace(config.Type) != "" {
			out.Type = strings.TrimSpace(config.Type)
		}
		if config.K > 0 {
			out.K = config.K
		}
		if value, exists := config.Weights[ChannelLexical]; exists {
			out.Weights[ChannelLexical] = math.Max(0, value)
		}
		if value, exists := config.Weights[ChannelVector]; exists {
			out.Weights[ChannelVector] = math.Max(0, value)
		}
		return out
	}
	raw, ok := asObject(value)
	if !ok {
		return out
	}
	if value, ok := raw["type"].(string); ok && strings.TrimSpace(value) != "" {
		out.Type = strings.TrimSpace(value)
	}
	if value := intValue(raw["k"]); value > 0 {
		out.K = value
	}
	if weights, ok := asObject(raw["weights"]); ok {
		if value, exists := weights[ChannelLexical]; exists {
			out.Weights[ChannelLexical] = math.Max(0, floatValue(value))
		}
		if value, exists := weights[ChannelVector]; exists {
			out.Weights[ChannelVector] = math.Max(0, floatValue(value))
		}
	}
	return out
}

func validateFusionConfig(value any) (FusionConfig, error) {
	config := normalizeFusionConfig(value)
	if config.Type != "weighted_rrf" {
		return FusionConfig{}, resource.InvalidCode("invalid_fusion_config", "融合类型仅支持 weighted_rrf")
	}
	if config.K <= 0 {
		return FusionConfig{}, resource.InvalidCode("invalid_fusion_config", "RRF 常数必须大于 0")
	}
	if config.Weights[ChannelLexical] < 0 || config.Weights[ChannelVector] < 0 {
		return FusionConfig{}, resource.InvalidCode("invalid_fusion_config", "RRF 权重不能为负数")
	}
	if config.Weights[ChannelLexical] == 0 && config.Weights[ChannelVector] == 0 {
		return FusionConfig{}, resource.InvalidCode("invalid_fusion_config", "RRF 权重不能同时为 0")
	}
	return config, nil
}

func embeddingConfigured(kb resource.Object) bool {
	return strings.TrimSpace(kb.String("embedding_model_id")) != ""
}

func embeddingReady(kb resource.Object) bool {
	return embeddingConfigured(kb) && objectInt64(kb["embedding_dimension"]) > 0
}

func kbFusionConfig(kb resource.Object) FusionConfig {
	return normalizeFusionConfig(kb["fusion_config"])
}

func kbCapabilities(kb resource.Object) IndexCapabilities {
	channels := []string{ChannelLexical}
	modes := []string{SearchModeLexical}
	if embeddingReady(kb) {
		channels = append(channels, ChannelVector)
		modes = []string{SearchModeLexical, SearchModeHybrid}
	}
	return IndexCapabilities{SearchModes: modes, Channels: channels, EmbeddingConfigured: embeddingConfigured(kb)}
}

func decorateRetrievalCapabilities(kb resource.Object) {
	fusion := kbFusionConfig(kb)
	kb["fusion_config"] = fusion
	kb["embedding_configured"] = embeddingConfigured(kb)
	kb["capabilities"] = kbCapabilities(kb)
}

func resolveChannels(kb resource.Object) channelDecision {
	if embeddingReady(kb) {
		return channelDecision{mode: SearchModeHybrid, channels: []string{ChannelLexical, ChannelVector}}
	}
	return channelDecision{mode: SearchModeLexical, channels: []string{ChannelLexical}}
}

func embeddingNotConfigured() error {
	return resource.InvalidCode("embedding_not_configured", "知识库未配置可用的向量模型")
}

func tokenizeText(value string) string {
	runes := []rune(strings.ToLower(value))
	tokens := make([]string, 0, len(runes)/2)
	seen := map[string]bool{}
	add := func(token string) {
		token = strings.TrimSpace(token)
		if token == "" || seen[token] {
			return
		}
		seen[token] = true
		tokens = append(tokens, token)
	}

	for index := 0; index < len(runes); {
		r := runes[index]
		switch {
		case unicode.Is(unicode.Han, r):
			start := index
			for index < len(runes) && unicode.Is(unicode.Han, runes[index]) {
				index++
			}
			sequence := runes[start:index]
			if len(sequence) == 1 {
				add(string(sequence))
				continue
			}
			for i := 0; i+1 < len(sequence); i++ {
				add(string(sequence[i : i+2]))
			}
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			start := index
			for index < len(runes) && (unicode.IsLetter(runes[index]) || unicode.IsDigit(runes[index])) {
				index++
			}
			add(string(runes[start:index]))
		default:
			index++
		}
	}
	if len(tokens) > defaultMaxSearchTokens {
		tokens = tokens[:defaultMaxSearchTokens]
	}
	return strings.Join(tokens, " ")
}

func weightedRRF(rank, k int, weight float64) float64 {
	if rank <= 0 || k <= 0 || weight <= 0 {
		return 0
	}
	return weight / float64(k+rank)
}

type rankedCandidate struct {
	item       resource.Object
	score      float64
	sources    map[string]bool
	rankByPath map[string]int
}

func fuseRankedChannels(channels []rankedChannel, configs map[string]FusionConfig) []resource.Object {
	candidates := map[string]*rankedCandidate{}
	for _, channel := range channels {
		config := configs[channel.kbID]
		if config.K <= 0 {
			config = defaultFusionConfig()
		}
		weight := config.Weights[channel.channel]
		for index, item := range channel.items {
			id := item.String("chunk_id")
			if id == "" {
				continue
			}
			candidate := candidates[id]
			if candidate == nil {
				candidate = &rankedCandidate{item: item, sources: map[string]bool{}, rankByPath: map[string]int{}}
				candidates[id] = candidate
			}
			key := channel.kbID + ":" + channel.channel
			if previous, ok := candidate.rankByPath[key]; ok && previous <= index+1 {
				continue
			}
			candidate.rankByPath[key] = index + 1
			candidate.score += weightedRRF(index+1, config.K, weight)
			candidate.sources[channel.channel] = true
		}
	}
	items := make([]resource.Object, 0, len(candidates))
	for _, candidate := range candidates {
		item := resource.Object{}
		for key, value := range candidate.item {
			item[key] = value
		}
		item["score"] = candidate.score
		switch {
		case candidate.sources[ChannelLexical] && candidate.sources[ChannelVector]:
			item["retrieval_source"] = "both"
		case candidate.sources[ChannelVector]:
			item["retrieval_source"] = ChannelVector
		default:
			item["retrieval_source"] = ChannelLexical
		}
		item["citation"] = resource.Object{
			"heading_path": item["heading_path"],
			"page_no":      item["page_no"],
			"source_url":   item["source_url"],
		}
		delete(item, "heading_path")
		delete(item, "page_no")
		delete(item, "source_url")
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		left, right := floatValue(items[i]["score"]), floatValue(items[j]["score"])
		if left != right {
			return left > right
		}
		return items[i].String("chunk_id") < items[j].String("chunk_id")
	})
	return items
}

type rankedChannel struct {
	kbID    string
	channel string
	items   []resource.Object
}

func limitPerDocument(items []resource.Object, topK int) []resource.Object {
	if topK <= 0 {
		return []resource.Object{}
	}
	out := make([]resource.Object, 0, topK)
	counts := map[string]int{}
	for _, item := range items {
		documentID := item.String("document_id")
		if counts[documentID] >= 2 {
			continue
		}
		counts[documentID]++
		out = append(out, item)
		if len(out) == topK {
			break
		}
	}
	return out
}

func fusionPayload(configs map[string]FusionConfig, kbs []string) map[string]any {
	if len(kbs) == 0 {
		config := defaultFusionConfig()
		return map[string]any{"type": config.Type, "k": config.K, "weights": config.Weights}
	}
	first := configs[kbs[0]]
	same := true
	for _, id := range kbs[1:] {
		config := configs[id]
		if config.K != first.K || config.Weights[ChannelLexical] != first.Weights[ChannelLexical] || config.Weights[ChannelVector] != first.Weights[ChannelVector] {
			same = false
			break
		}
	}
	if same {
		return map[string]any{"type": first.Type, "k": first.K, "weights": first.Weights}
	}
	weights := map[string]any{}
	kByKB := map[string]int{}
	for _, id := range kbs {
		weights[id] = configs[id].Weights
		kByKB[id] = configs[id].K
	}
	return map[string]any{"type": "weighted_rrf", "k_by_kb": kByKB, "weights_by_kb": weights}
}

func asObject(value any) (map[string]any, bool) {
	switch v := value.(type) {
	case map[string]any:
		return v, true
	case resource.Object:
		return map[string]any(v), true
	case map[string]float64:
		out := make(map[string]any, len(v))
		for key, value := range v {
			out[key] = value
		}
		return out, true
	case json.RawMessage:
		var out map[string]any
		if json.Unmarshal(v, &out) != nil {
			return nil, false
		}
		return out, true
	default:
		return nil, false
	}
}

func intValue(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float32:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		parsed, _ := v.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func removeString(values []string, target string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != target {
			out = append(out, value)
		}
	}
	return out
}
