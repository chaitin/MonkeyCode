package kb

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestPublicKBListSharingProjection(t *testing.T) {
	owner := resource.User{ID: "owner-1", Name: "Owner", Email: "owner@example.com"}
	recipientID := "recipient-1"
	item := resource.Object{
		"id":             "kb-1",
		"name":           "KB",
		"ownership_type": "user",
		"user":           owner,
		"shared_users":   []resource.Object{{"id": recipientID}},
		"shared_groups":  []resource.Object{{"id": "group-1"}},
		"grants":         []resource.Object{{"user_id": recipientID}},
	}

	ownerList := publicKBList(item, owner.ID)
	if got, ok := ownerList["user"].(resource.User); !ok || got.ID != owner.ID {
		t.Fatalf("所有者列表 user = %#v", ownerList["user"])
	}
	if _, ok := ownerList["shared_users"]; !ok {
		t.Fatal("所有者列表缺少 shared_users")
	}
	if _, ok := ownerList["shared_groups"]; !ok {
		t.Fatal("所有者列表缺少 shared_groups")
	}
	if _, ok := ownerList["grants"]; ok {
		t.Fatal("列表不应返回 grants")
	}

	recipientList := publicKBList(item, recipientID)
	if got, ok := recipientList["user"].(resource.User); !ok || got.ID != owner.ID {
		t.Fatalf("接收方列表 user = %#v", recipientList["user"])
	}
	if _, ok := recipientList["shared_users"]; ok {
		t.Fatal("接收方列表不应返回 shared_users")
	}
	if _, ok := recipientList["shared_groups"]; ok {
		t.Fatal("接收方列表不应返回 shared_groups")
	}

	ownerDetail := publicKBDetail(item, owner.ID)
	if _, ok := ownerDetail["grants"]; !ok {
		t.Fatal("所有者详情缺少 grants")
	}
	if _, ok := ownerDetail["shared_users"]; !ok {
		t.Fatal("所有者详情缺少 shared_users")
	}
	if _, ok := ownerDetail["shared_groups"]; !ok {
		t.Fatal("所有者详情缺少 shared_groups")
	}
	recipientDetail := publicKBDetail(item, recipientID)
	if _, ok := recipientDetail["grants"]; ok {
		t.Fatal("接收方详情不应返回 grants")
	}
	if _, ok := recipientDetail["shared_users"]; ok {
		t.Fatal("接收方详情不应返回 shared_users")
	}
}

func TestPublicKBListSystemOwner(t *testing.T) {
	creator := resource.User{ID: "admin-1", Name: "Admin", Email: "admin@example.com"}
	item := resource.Object{
		"id":             "kb-system",
		"name":           "System KB",
		"ownership_type": "system",
		"user":           creator,
	}

	list := publicKBList(item, "user-1")
	if got, ok := list["user"].(resource.User); !ok || got.ID != creator.ID {
		t.Fatalf("系统知识库 user = %#v", list["user"])
	}
	if _, ok := list["shared_users"]; ok {
		t.Fatal("系统知识库不应返回 shared_users")
	}
	if _, ok := list["grants"]; ok {
		t.Fatal("列表不应返回 grants")
	}

	detail := publicKBDetail(item, "user-1")
	if _, ok := detail["grants"]; ok {
		t.Fatal("非所有者详情不应返回 grants")
	}
}

func TestPublicKBListMissingOwner(t *testing.T) {
	item := resource.Object{
		"id":             "kb-1",
		"ownership_type": "system",
	}
	list := publicKBList(item, "user-1")
	got, ok := list["user"].(resource.User)
	if !ok || got.ID != "" {
		t.Fatalf("缺少所有者时应返回零值 user，实际 %#v", list["user"])
	}
}
