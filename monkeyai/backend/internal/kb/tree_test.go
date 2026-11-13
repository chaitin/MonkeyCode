package kb

import (
	"reflect"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestBuildDocumentTree(t *testing.T) {
	items := []resource.Object{
		{"id": "folder", "parent_id": "", "title": "制度", "position": 1.0},
		{"id": "doc", "parent_id": "folder", "title": "差旅", "position": 2.0},
		{"id": "root", "title": "根文档", "position": 3.0},
	}
	tree := buildDocumentTree(items)
	if len(tree) != 2 || tree[0].String("id") != "folder" || tree[1].String("id") != "root" {
		t.Fatalf("根节点不正确: %v", tree)
	}
	children, _ := tree[0]["children"].([]resource.Object)
	if len(children) != 1 || children[0].String("id") != "doc" {
		t.Fatalf("子节点不正确: %#v", children)
	}
	if documentDescendsFrom(items, "doc", "folder") != true || documentDescendsFrom(items, "folder", "doc") {
		t.Fatal("子孙判断不正确")
	}
	public := publicDocumentTree(tree)
	if _, ok := public[0]["children"]; !ok || reflect.ValueOf(public[0]["children"]).Len() != 1 {
		t.Fatalf("公开树缺少 children: %v", public[0])
	}
}

func TestBatchDeleteOrderRemovesDescendantsFirst(t *testing.T) {
	selected := map[string]bool{"folder": true, "doc": true}
	children := map[string][]string{"folder": {"doc", "nested"}, "nested": {"leaf"}}
	order := batchDeleteOrder([]string{"folder", "doc"}, selected, children)
	want := []string{"doc", "leaf", "nested", "folder"}
	if !reflect.DeepEqual(order, want) {
		t.Fatalf("删除顺序不正确: %v", order)
	}
}

func TestBatchAncestorSelectedSkipsCoveredChildren(t *testing.T) {
	selected := map[string]bool{"folder": true, "doc": true}
	parents := map[string]string{"doc": "folder", "folder": ""}
	if !batchAncestorSelected("doc", selected, parents) || batchAncestorSelected("folder", selected, parents) {
		t.Fatal("已选祖先判断不正确")
	}
}

func TestNormalizeBatchIDsRejectsEmptyAndOverLimit(t *testing.T) {
	ids, err := normalizeBatchIDs([]string{" a ", "a", ""})
	if err != nil || len(ids) != 1 || ids[0] != "a" {
		t.Fatalf("去重结果不正确: %v %v", ids, err)
	}
	tooMany := make([]string, maxBatchDocuments+1)
	for i := range tooMany {
		tooMany[i] = string(rune('a'+i%26)) + string(rune(i))
	}
	if _, err = normalizeBatchIDs(tooMany); err == nil {
		t.Fatal("超限请求应被拒绝")
	}
}
