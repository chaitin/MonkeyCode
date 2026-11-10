package kb

import (
	"context"
	"sort"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (s *Service) searchAccessible(ctx context.Context, accessible []resource.Object, input SearchInput) (SearchResponse, error) {
	normalized, err := normalizeSearchInput(input)
	if err != nil {
		return SearchResponse{}, err
	}
	byID := make(map[string]resource.Object, len(accessible))
	for _, item := range accessible {
		byID[item.String("id")] = item
	}
	ids := append([]string(nil), normalized.KbIDs...)
	if len(ids) == 0 {
		for id := range byID {
			ids = append(ids, id)
		}
		sort.Strings(ids)
	}
	if len(ids) > 50 {
		return SearchResponse{}, resource.Invalid("kb_ids 不能超过 50 个")
	}
	if len(ids) == 0 {
		return emptySearchResponse(normalized), nil
	}
	for _, id := range ids {
		if byID[id] == nil {
			return SearchResponse{}, resource.NotFound
		}
	}

	queryTokens := tokenizeText(normalized.Query)
	if queryTokens == "" {
		return SearchResponse{}, resource.Invalid("检索问题未生成可检索词")
	}
	queryExpression := strings.Join(strings.Fields(queryTokens), " | ")
	decisions := map[string]channelDecision{}
	configs := map[string]FusionConfig{}
	warnings := []string{}
	degraded := false
	modelVectors := map[string]string{}
	modelErrors := map[string]error{}

	for _, id := range ids {
		item := byID[id]
		decision := resolveChannels(item)
		configs[id] = kbFusionConfig(item)
		warnings = append(warnings, decision.warnings...)
		degraded = degraded || decision.degraded
		if !containsString(decision.channels, ChannelVector) {
			decisions[id] = decision
			continue
		}

		modelID := strings.TrimSpace(item.String("embedding_model_id"))
		vector, ok := modelVectors[modelID]
		if !ok && modelErrors[modelID] == nil {
			if s.models == nil {
				modelErrors[modelID] = embeddingNotConfigured()
			} else {
				result, embedErr := s.models.EmbedText(ctx, modelID, normalized.Query)
				if embedErr != nil {
					modelErrors[modelID] = embedErr
				} else if formatted, formatErr := formatVector(result.Vector); formatErr != nil {
					modelErrors[modelID] = formatErr
				} else {
					vector = formatted
					modelVectors[modelID] = vector
				}
			}
		}
		if embedErr := modelErrors[modelID]; embedErr != nil {
			decision.channels = removeString(decision.channels, ChannelVector)
			if len(decision.channels) == 0 {
				return SearchResponse{}, resource.InvalidCode("vector_unavailable", "向量通道不可用: "+embedErr.Error())
			}
			decision.degraded = true
			decision.warnings = append(decision.warnings, "vector_channel_failed")
			decision.mode = SearchModeLexical
			warnings = append(warnings, "vector_channel_failed")
			degraded = true
		}
		decisions[id] = decision
	}

	queries := sqlc.New(s.store.Pool)
	ranked := []rankedChannel{}
	used := map[string]bool{}
	for _, id := range ids {
		item := byID[id]
		decision := decisions[id]
		for _, channel := range decision.channels {
			var items []resource.Object
			switch channel {
			case ChannelLexical:
				raw, queryErr := queries.SearchKbChunksLexical(ctx, sqlc.SearchKbChunksLexicalParams{
					KbID:            id,
					QueryExpression: queryExpression,
					RowLimit:        defaultSearchCandidate,
				})
				if queryErr != nil {
					return SearchResponse{}, queryErr
				}
				items, err = resource.DecodeObjects(raw, nil)
			case ChannelVector:
				modelID := strings.TrimSpace(item.String("embedding_model_id"))
				raw, queryErr := queries.SearchKbChunksVector(ctx, sqlc.SearchKbChunksVectorParams{
					KbID:             id,
					Embedding:        modelVectors[modelID],
					EmbeddingModelID: modelID,
					RowLimit:         defaultSearchCandidate,
				})
				if queryErr != nil {
					decision.channels = removeString(decision.channels, ChannelVector)
					decision.degraded = true
					decision.warnings = append(decision.warnings, "vector_channel_failed")
					decision.mode = modeForChannels(decision.channels)
					warnings = append(warnings, "vector_channel_failed")
					continue
				}
				items, err = resource.DecodeObjects(raw, nil)
			}
			if err != nil {
				return SearchResponse{}, err
			}
			used[channel] = true
			if len(items) == 0 {
				continue
			}
			ranked = append(ranked, rankedChannel{kbID: id, channel: channel, items: items})
		}
		decisions[id] = decision
		degraded = degraded || decision.degraded
	}

	channelsUsed := make([]string, 0, 2)
	for _, channel := range []string{ChannelLexical, ChannelVector} {
		if used[channel] {
			channelsUsed = append(channelsUsed, channel)
		}
	}
	if len(channelsUsed) == 0 {
		return SearchResponse{
			Query:         normalized.Query,
			RetrievalMode: effectiveModeForDecisions(decisions),
			ChannelsUsed:  channelsUsed,
			Fusion:        fusionPayload(configs, ids),
			Degraded:      degraded,
			Warnings:      uniqueStrings(warnings),
			Items:         []resource.Object{},
		}, nil
	}
	items := fuseRankedChannels(ranked, configs)
	items = limitPerDocument(items, normalized.TopK)
	if len(normalized.Filters) > 0 {
		warnings = append(warnings, "filters_not_applied")
	}
	return SearchResponse{
		Query:         normalized.Query,
		RetrievalMode: modeForChannels(channelsUsed),
		ChannelsUsed:  channelsUsed,
		Fusion:        fusionPayload(configs, ids),
		Degraded:      degraded,
		Warnings:      uniqueStrings(warnings),
		Items:         items,
	}, nil
}

func emptySearchResponse(input SearchInput) SearchResponse {
	return SearchResponse{
		Query:         input.Query,
		RetrievalMode: SearchModeLexical,
		ChannelsUsed:  []string{},
		Fusion:        fusionPayload(nil, nil),
		Warnings:      []string{},
		Items:         []resource.Object{},
	}
}

func modeForChannels(channels []string) string {
	if len(channels) == 0 {
		return SearchModeLexical
	}
	if len(channels) > 1 {
		return SearchModeHybrid
	}
	return channels[0]
}

func effectiveModeForDecisions(decisions map[string]channelDecision) string {
	used := map[string]bool{}
	for _, decision := range decisions {
		for _, channel := range decision.channels {
			used[channel] = true
		}
	}
	channels := make([]string, 0, len(used))
	for _, channel := range []string{ChannelLexical, ChannelVector} {
		if used[channel] {
			channels = append(channels, channel)
		}
	}
	return modeForChannels(channels)
}
