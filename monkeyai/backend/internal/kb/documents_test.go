package kb

import (
	"reflect"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestLearnedKBIDs(t *testing.T) {
	items := []resource.Object{
		{"id": "learned-int64", "learned_count": int64(2)},
		{"id": "learned-float64", "learned_count": float64(1)},
		{"id": "empty", "learned_count": int64(0)},
		{"id": "missing"},
		{"learned_count": int64(1)},
	}
	if got, want := learnedKBIDs(items), []string{"learned-int64", "learned-float64"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("learnedKBIDs() = %v, want %v", got, want)
	}
}

func TestNormalizeSearchInputLimits(t *testing.T) {
	if _, err := normalizeSearchInput(SearchInput{Query: "q", TopK: 21}); err == nil {
		t.Fatal("top_k 超过 20 应返回错误")
	}
	if input, err := normalizeSearchInput(SearchInput{Query: "q", TopK: 20}); err != nil || input.TopK != 20 {
		t.Fatalf("top_k=20 应通过: %+v, %v", input, err)
	}
	if _, err := normalizeSearchInput(SearchInput{Query: strings.Repeat("字", 4001)}); err == nil {
		t.Fatal("超过 4000 字符的查询应返回错误")
	}
}

func TestPublicDocumentSummaryExcludesContent(t *testing.T) {
	item := resource.Object{
		"id":      "document-1",
		"kb_id":   "kb-1",
		"title":   "制度",
		"content": "不应出现在文档列表中",
		"status":  "learned",
	}
	got := publicDocumentSummary(item)
	if _, ok := got["content"]; ok {
		t.Fatal("文档列表不应返回正文")
	}
	if got.String("id") != "document-1" || got.String("status") != "learned" {
		t.Fatalf("文档元数据不完整: %v", got)
	}
}

func TestFilterDocumentPage(t *testing.T) {
	items := []resource.Object{
		{"id": "1", "title": "差旅制度", "file_name": "travel.pdf", "source_type": "file", "status": "learned", "content": "正文 1"},
		{"id": "2", "title": "差旅报销", "file_name": "reimburse.pdf", "source_type": "file", "status": "learning", "content": "正文 2"},
		{"id": "3", "title": "员工手册", "file_name": "handbook.pdf", "source_type": "file", "status": "learned", "content": "正文 3"},
		{"id": "4", "title": "差旅说明", "file_name": "travel.txt", "source_type": "text", "status": "learned", "content": "正文 4"},
	}

	page, err := filterDocumentPage(items, DocumentListFilter{Query: "TRAVEL", Status: "learned", SourceType: "file", Page: 1, PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 1 || page.Page != 1 || page.PageSize != 1 || len(page.Items) != 1 || page.Items[0].String("id") != "1" {
		t.Fatalf("筛选和分页结果不正确: %+v", page)
	}
	if _, ok := page.Items[0]["content"]; ok {
		t.Fatal("文档列表不应返回正文")
	}

	page, err = filterDocumentPage(items, DocumentListFilter{Query: "差旅", Page: 2, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 3 || len(page.Items) != 1 || page.Items[0].String("id") != "4" {
		t.Fatalf("第二页结果不正确: %+v", page)
	}

	page, err = filterDocumentPage(items, DocumentListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 4 || len(page.Items) != 4 || page.Page != 1 || page.PageSize != documentDefaultPageSize {
		t.Fatalf("默认分页结果不正确: %+v", page)
	}

	for _, filter := range []DocumentListFilter{
		{Status: "unknown"},
		{SourceType: "url"},
		{Page: -1},
		{PageSize: documentMaxPageSize + 1},
	} {
		if _, err := filterDocumentPage(items, filter); err == nil {
			t.Fatalf("非法筛选参数应返回错误: %+v", filter)
		}
	}
}
