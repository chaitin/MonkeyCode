package session

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestSessionGroupSnapshot(t *testing.T) {
	for _, change := range []string{"成员分组变化", "首次生成计费账户", "计费分组变化"} {
		t.Run(change, func(t *testing.T) {
			s, identities, userID, token := sessionDBFixture(t)
			ctx := t.Context()
			oldGroup, newGroup := resource.ID(), resource.ID()
			exec := func(query string, args ...any) {
				t.Helper()
				if _, err := s.pool.Exec(ctx, query, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`INSERT INTO groups(id,name) VALUES($1,'原分组'),($2,'新分组')`, oldGroup, newGroup)
			exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, oldGroup, userID)
			createAccount := func(groupID string) {
				exec(`INSERT INTO credit_accounts(user_id,group_id,period_start_at,period_end_at,last_refreshed_at)
VALUES($1,$2,now()-interval '1 day',now()+interval '1 day',now())`, userID, groupID)
			}
			if change == "计费分组变化" {
				createAccount(oldGroup)
			}
			resolve := func(id, parent, wantGroup string) {
				t.Helper()
				row, err := s.ResolveSession(ctx, userID, id, parent, "")
				if err != nil {
					t.Fatalf("解析会话失败: %v", err)
				}
				if row.GroupID == nil || *row.GroupID != wantGroup {
					t.Fatalf("会话分组错误: got=%v want=%s", row.GroupID, wantGroup)
				}
			}
			parentID, childID, machineID := resource.ID(), resource.ID(), resource.ID()
			resolve(parentID, "", oldGroup)
			resolve(childID, parentID, oldGroup)
			router := chi.NewRouter()
			router.Use(identities.RequireAgent)
			s.RegisterAgent(router)
			started := time.Now().UTC().Truncate(time.Second).Add(-time.Minute)
			put := func(seq int) {
				t.Helper()
				body, err := json.Marshal(resource.Object{
					"state_seq": seq, "session_type": "conversation", "started_at": started,
					"client": resource.Object{"type": "desktop", "machine_id": machineID, "version": "1"},
				})
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(http.MethodPut, "/sessions/"+parentID, bytes.NewReader(body))
				req.Header.Set("Authorization", "Bearer "+token)
				req.Header.Set("X-MAI-Machine-ID", machineID)
				req.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, req)
				if response.Code != http.StatusOK {
					t.Fatalf("会话上报失败: HTTP %d: %s", response.Code, response.Body.String())
				}
			}
			put(1)
			switch change {
			case "成员分组变化":
				exec(`UPDATE group_users SET removed_at=now() WHERE user_id=$1`, userID)
				exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, newGroup, userID)
			case "首次生成计费账户":
				createAccount(newGroup)
			case "计费分组变化":
				exec(`UPDATE credit_accounts SET group_id=$2 WHERE user_id=$1`, userID, newGroup)
			}

			put(2)
			resolve(parentID, "", oldGroup)
			resolve(childID, "", oldGroup)
			resolve(resource.ID(), "", newGroup)
			resolve(resource.ID(), parentID, oldGroup)
			if err := s.EnsureSession(ctx, userID, parentID, "", newGroup); code(err) != "invalid_session" {
				t.Fatalf("显式更换会话分组应被拒绝: %v", err)
			}
		})
	}
}

func TestSessionGroupClaim(t *testing.T) {
	s, _, userID, _ := sessionDBFixture(t)
	ctx := t.Context()
	parentID, childID, groupID := resource.ID(), resource.ID(), resource.ID()
	for _, pair := range []struct{ id, parent string }{{parentID, ""}, {childID, parentID}} {
		row, err := s.ResolveSession(ctx, userID, pair.id, pair.parent, "")
		if err != nil || row.GroupID != nil {
			t.Fatalf("无默认分组时应允许创建会话: group=%v err=%v", row.GroupID, err)
		}
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO groups(id,name) VALUES($1,'父会话分组')`, groupID); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSession(ctx, userID, parentID, "", groupID); err != nil {
		t.Fatal(err)
	}
	row, err := s.ResolveSession(ctx, userID, childID, "", "")
	if err != nil || row.GroupID == nil || *row.GroupID != groupID {
		t.Fatalf("省略父会话 ID 时仍应继承已登记父会话的分组: group=%v err=%v", row.GroupID, err)
	}
}
