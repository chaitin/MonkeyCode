package kb

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type countingEmbedder struct {
	calls int
}

func (e *countingEmbedder) EmbedText(context.Context, string, string) (model.EmbeddingResult, error) {
	e.calls++
	return model.EmbeddingResult{Vector: []float64{1, 0}}, nil
}

func TestResolveChannelsWithoutEmbeddingUsesLexical(t *testing.T) {
	kb := resource.Object{
		"embedding_model_id": nil,
	}
	decision := resolveChannels(kb)
	if decision.mode != SearchModeLexical || !reflect.DeepEqual(decision.channels, []string{ChannelLexical}) || decision.degraded {
		t.Fatalf("无 embedding 应固定使用 lexical: %+v", decision)
	}
}

func TestResolveChannelsWithEmbeddingUsesHybrid(t *testing.T) {
	kb := resource.Object{
		"embedding_model_id":  "model-1",
		"embedding_dimension": int64(2),
	}
	decision := resolveChannels(kb)
	if decision.mode != SearchModeHybrid || !reflect.DeepEqual(decision.channels, []string{ChannelLexical, ChannelVector}) || decision.degraded {
		t.Fatalf("可用 embedding 应固定使用 lexical+vector: %+v", decision)
	}
}

func TestDecoratedRetrievalConfigKeepsCapabilities(t *testing.T) {
	kb := resource.Object{
		"embedding_model_id":  "model-1",
		"embedding_dimension": int64(3),
		"fusion_config":       map[string]any{"type": "weighted_rrf", "k": 42, "weights": map[string]any{"lexical": 0.4, "vector": 0.6}},
	}
	decorateRetrievalCapabilities(kb)
	capabilities := kbCapabilities(kb)
	if !reflect.DeepEqual(capabilities.Channels, []string{ChannelLexical, ChannelVector}) {
		t.Fatalf("装饰后向量能力丢失: %+v", capabilities)
	}
	if !reflect.DeepEqual(capabilities.SearchModes, []string{SearchModeLexical, SearchModeHybrid}) {
		t.Fatalf("检索模式能力不正确: %+v", capabilities)
	}
	fusion := kbFusionConfig(kb)
	if fusion.K != 42 || fusion.Weights[ChannelLexical] != 0.4 || fusion.Weights[ChannelVector] != 0.6 {
		t.Fatalf("装饰后融合配置丢失: %+v", fusion)
	}
	if _, ok := kb["index_strategy"]; ok {
		t.Fatal("知识库不再持久化或返回 index_strategy")
	}
	decision := resolveChannels(kb)
	if !reflect.DeepEqual(decision.channels, []string{ChannelLexical, ChannelVector}) || decision.degraded {
		t.Fatalf("装饰后混合检索通道不正确: %+v", decision)
	}
}

func TestShouldVectorizeRequiresEmbeddingModel(t *testing.T) {
	embedder := &countingEmbedder{}
	cases := []struct {
		name string
		kb   resource.Object
		emb  Embedder
		want bool
	}{
		{name: "未配置模型", kb: resource.Object{}, emb: embedder},
		{name: "缺少维度", kb: resource.Object{"embedding_model_id": "m"}, emb: embedder},
		{name: "模型服务不可用", kb: resource.Object{"embedding_model_id": "m", "embedding_dimension": int64(2)}},
		{name: "完整启用", kb: resource.Object{"embedding_model_id": "m", "embedding_dimension": int64(2)}, emb: embedder, want: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldVectorize(test.emb, test.kb); got != test.want {
				t.Fatalf("shouldVectorize = %v, want %v", got, test.want)
			}
		})
	}
	if embedder.calls != 0 {
		t.Fatalf("能力判断不应调用 EmbedText: %d", embedder.calls)
	}
}

func TestWeightedRRFFusesRanksAndSources(t *testing.T) {
	configs := map[string]FusionConfig{"kb": defaultFusionConfig()}
	channels := []rankedChannel{
		{kbID: "kb", channel: ChannelLexical, items: []resource.Object{{"chunk_id": "a", "document_id": "doc-a"}, {"chunk_id": "b", "document_id": "doc-b"}}},
		{kbID: "kb", channel: ChannelVector, items: []resource.Object{{"chunk_id": "b", "document_id": "doc-b"}, {"chunk_id": "c", "document_id": "doc-c"}}},
	}
	items := fuseRankedChannels(channels, configs)
	if got := []string{items[0].String("chunk_id"), items[1].String("chunk_id"), items[2].String("chunk_id")}; !reflect.DeepEqual(got, []string{"b", "c", "a"}) {
		t.Fatalf("RRF 排序 = %v", got)
	}
	if items[0].String("retrieval_source") != "both" || items[1].String("retrieval_source") != ChannelVector {
		t.Fatalf("retrieval_source 不正确: %#v", items)
	}
	want := weightedRRF(1, 60, 0.7) + weightedRRF(2, 60, 0.3)
	if score := floatValue(items[0]["score"]); score != want {
		t.Fatalf("RRF score = %v, want %v", score, want)
	}
}

func TestTokenizeTextBuildsChineseBigrams(t *testing.T) {
	tokens := tokenizeText("员工出差住宿标准ABC 123")
	for _, expected := range []string{"员工", "工出", "出差", "住宿", "标准", "abc", "123"} {
		if !containsString(strings.Fields(tokens), expected) {
			t.Fatalf("分词缺少 %q: %s", expected, tokens)
		}
	}
}

func TestLimitPerDocumentKeepsAtMostTwoChunks(t *testing.T) {
	items := []resource.Object{
		{"chunk_id": "1", "document_id": "doc-1"},
		{"chunk_id": "2", "document_id": "doc-1"},
		{"chunk_id": "3", "document_id": "doc-1"},
		{"chunk_id": "4", "document_id": "doc-2"},
	}
	out := limitPerDocument(items, 10)
	if len(out) != 3 || out[2].String("chunk_id") != "4" {
		t.Fatalf("同文档最多保留两个分片: %#v", out)
	}
}
