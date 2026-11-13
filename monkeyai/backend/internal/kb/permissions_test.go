package kb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestKnowledgeBaseContentPermissions(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)
	user, other := resource.ID(), resource.ID()
	for _, id := range []string{user, other} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'member',$2)`, id, id+"@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	kb, err := service.CRUD.Save(ctx, admin, "", "", resource.Object{"name": "shared system"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := kb.String("id")
	grant := func(level string) {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err = newRepository(tx).LockResource(ctx, kbID); err != nil {
			t.Fatal(err)
		}
		if err = resource.SaveKbGrants(ctx, tx, kbID, admin, []resource.Object{{"user_id": user, "access_level": level}}, false); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	grant("read_only")
	if _, err := service.CreateUserDocument(ctx, user, DocumentInput{KbID: kbID, Title: "denied", Content: "body"}); resource.AsError(err).Status != http.StatusForbidden {
		t.Fatalf("read-only write: %v", err)
	}
	grant("read_write")
	accessible, err := service.GetAccessible(ctx, kbID, user)
	if err != nil {
		t.Fatal(err)
	}
	permissions := accessible["permissions"].(Permissions)
	if !permissions.CanWriteContent || permissions.CanManagePermissions || permissions.CanDeleteKnowledgeBase {
		t.Fatalf("permissions: %+v", permissions)
	}
	doc, err := service.CreateUserDocument(ctx, user, DocumentInput{KbID: kbID, Title: "shared", Content: "body"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.String("updated_by_user_id") != user {
		t.Fatalf("missing author: %v", doc)
	}
	if _, err = service.UpdateUserDocument(ctx, user, doc.String("id"), DocumentInput{Content: "missing revision"}); resource.AsError(err).Status != 428 {
		t.Fatalf("missing version: %v", err)
	}
	updated, err := service.UpdateUserDocument(ctx, user, doc.String("id"), DocumentInput{Content: "new", ExpectedRevision: objectInt64(doc["revision"])})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.UpdateUserDocument(ctx, user, doc.String("id"), DocumentInput{Content: "lost update", ExpectedRevision: objectInt64(doc["revision"])}); resource.AsError(err).Status != 412 {
		t.Fatalf("stale version: %v", err)
	}
	if _, err = service.UpdateUserKB(ctx, user, kbID, `"1"`, resource.Object{"name": "take over"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("editor changed KB: %v", err)
	}
	if err = service.DeleteUserKB(ctx, user, kbID, `"1"`); !errors.Is(err, resource.NotFound) {
		t.Fatalf("editor deleted KB: %v", err)
	}
	if _, err = service.CreateUserDocument(ctx, other, DocumentInput{KbID: kbID, Title: "unshared", Content: "body"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("outsider: %v", err)
	}
	// Existing MCP tools use the same per-user write permission and version checks.
	params, _ := json.Marshal(map[string]any{"name": "kb_update_document", "arguments": map[string]any{"kb_id": kbID, "document_id": doc.String("id"), "content": "MCP edit", "expected_revision": updated["revision"]}})
	if _, err = service.callMCPTool(ctx, user, params); err != nil {
		t.Fatal(err)
	}
	// Revocation wins the KB lock before a blocked mutation rechecks permission.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = newRepository(tx).LockResource(ctx, kbID); err != nil {
		t.Fatal(err)
	}
	if err = resource.SaveKbGrants(ctx, tx, kbID, admin, []resource.Object{{"user_id": user, "access_level": "read_only"}}, false); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, e := service.CreateUserDocument(ctx, user, DocumentInput{KbID: kbID, Title: "revoked", Content: "body"})
		result <- e
	}()
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-result:
		if resource.AsError(err).Status != 403 {
			t.Fatalf("revoked write: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("write blocked after revoke")
	}
	grant("read_write")
	current, err := service.GetDocument(ctx, doc.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	if err = service.deleteDocument(ctx, doc.String("id"), user, objectInt64(current["revision"])); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE knowledge_bases SET enabled=false WHERE id=$1`, kbID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.CreateUserDocument(ctx, user, DocumentInput{KbID: kbID, Title: "disabled", Content: "body"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("disabled write: %v", err)
	}
}

func TestKnowledgeBaseGrantIdentityAndInheritance(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)
	kb, err := service.CRUD.Save(ctx, admin, "", "", resource.Object{"name": "grant inheritance"})
	if err != nil {
		t.Fatal(err)
	}
	id, user, parent, child := kb.String("id"), resource.ID(), resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'member',$2)`, user, user+"@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO groups(id,name) VALUES($1,'parent')`, parent); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO groups(id,name,parent_id) VALUES($1,'child',$2)`, child, parent); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, child, user, admin); err != nil {
		t.Fatal(err)
	}
	save := func(entries []resource.Object) error {
		tx, e := pool.Begin(ctx)
		if e != nil {
			return e
		}
		defer tx.Rollback(context.Background())
		if _, e = newRepository(tx).LockResource(ctx, id); e != nil {
			return e
		}
		if e = resource.SaveKbGrants(ctx, tx, id, admin, entries, false); e != nil {
			return e
		}
		return tx.Commit(ctx)
	}
	if err = save([]resource.Object{{"group_id": parent, "access_level": "read_write"}, {"user_id": user, "access_level": "read_only"}}); err != nil {
		t.Fatal(err)
	}
	before, err := resource.Grants(ctx, pool, "kb", id)
	if err != nil {
		t.Fatal(err)
	}
	current, err := service.GetAccessible(ctx, id, user)
	if err != nil {
		t.Fatal(err)
	}
	if !current["permissions"].(Permissions).CanWriteContent {
		t.Fatal("parent group write was overridden by user read")
	}
	// Old clients omit access_level: preserve permissions and grant IDs.
	if err = save([]resource.Object{{"group_id": parent}, {"user_id": user}}); err != nil {
		t.Fatal(err)
	}
	after, err := resource.Grants(ctx, pool, "kb", id)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(before) != fmt.Sprint(after) {
		t.Fatalf("legacy save rewrote grants: %v -> %v", before, after)
	}
	if err = save([]resource.Object{{"user_id": user}, {"user_id": user}}); err == nil {
		t.Fatal("duplicate subject accepted")
	}
	if err = save([]resource.Object{{"user_id": user, "access_level": "manage"}}); err == nil {
		t.Fatal("third permission accepted")
	}
	if err = save([]resource.Object{{"user_id": user, "access_level": "read_only"}}); err != nil {
		t.Fatal(err)
	}
	current, err = service.GetAccessible(ctx, id, user)
	if err != nil {
		t.Fatal(err)
	}
	if current["permissions"].(Permissions).CanWriteContent {
		t.Fatal("removed group grant still writable")
	}
}
