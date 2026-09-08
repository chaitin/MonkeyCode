package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestResolveModelName(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行模型解析集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_model_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	owner, user, admin := resource.ID(), resource.ID(), resource.ID()
	exec(`INSERT INTO users(id,name,email,role) VALUES($1,'所有者','owner@example.com','user'),($2,'调用者','user@example.com','user'),($3,'管理员','admin@example.com','admin')`, owner, user, admin)
	repo := NewPostgres(pool)
	create := func(name, ownership string) Model {
		t.Helper()
		item, err := repo.Create(ctx, Model{
			OwnerUserID: owner, OwnershipType: ownership, ModelID: name, DisplayName: name,
			Protocol: ProtocolOpenAIChat, BaseURL: "https://example.com/v1", APIKey: "test-key",
			AdvancedConfig: AdvancedConfig{ContextWindowTokens: 32000, MaxOutputTokens: 4096}, CreditMultiplier: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		return item
	}
	shared := create("provider/chat-model", "system")
	exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('model',$1,$2,'read_only',$3)`, shared.ID, user, owner)
	private := create("private-model", "user")
	disabled := create("disabled-model", "system")
	exec(`UPDATE models SET enabled=false WHERE id=$1`, disabled.ID)
	deleted := create("deleted-model", "system")
	exec(`UPDATE models SET deleted_at=now() WHERE id=$1`, deleted.ID)
	uuidName := create(resource.ID(), "user")
	create(shared.ID, "user")
	create(shared.ModelID, "system")
	groupModel := create("group-model", "system")
	parent, child := resource.ID(), resource.ID()
	exec(`INSERT INTO groups(id,name,parent_id) VALUES($1,'父组',NULL),($2,'子组',$1)`, parent, child)
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, child, user, owner)
	exec(`INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,granted_by_user_id) VALUES('model',$1,$2,'read_only',$3)`, groupModel.ID, parent, owner)

	for _, tc := range []struct {
		name, user, requested, want string
	}{
		{"模型名", user, shared.ModelID, shared.ID},
		{"主键", user, shared.ID, shared.ID},
		{"主键优先", owner, shared.ID, shared.ID},
		{"同名稳定选择", owner, shared.ModelID, shared.ID},
		{"UUID格式模型名", owner, uuidName.ModelID, uuidName.ID},
		{"自有模型", owner, private.ModelID, private.ID},
		{"父组授权", user, groupModel.ModelID, groupModel.ID},
		{"管理员系统模型", admin, shared.ModelID, shared.ID},
		{"未授权", user, private.ModelID, ""},
		{"管理员无权使用他人私有模型", admin, private.ModelID, ""},
		{"已停用", admin, disabled.ModelID, ""},
		{"已删除", admin, deleted.ModelID, ""},
		{"不存在", user, "missing-model", ""},
		{"空模型名", user, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := NewService(repo).WithKeyAuthenticator(keyAuthenticatorStub{userID: tc.user})
			target, err := service.Resolve(ctx, "test-key", tc.requested)
			if tc.want == "" {
				if !errors.Is(err, ErrUnauthorized) {
					t.Fatalf("应拒绝调用，实际错误: %v", err)
				}
				return
			}
			if err != nil || target.ID != tc.want || target.UserID != tc.user || target.UpstreamModelID == "" || target.APIKey != "test-key" {
				t.Fatalf("模型解析错误: %+v, %v", target, err)
			}
		})
	}
	models, err := NewService(repo).AgentModels(ctx, user, false)
	if err != nil || len(models) != 2 {
		t.Fatalf("下发模型目录错误: %+v, %v", models, err)
	}
	for _, entry := range models {
		item, err := repo.Resolve(ctx, user, entry.Model)
		if err != nil || item.ID != entry.ID || item.ModelID != entry.Model {
			t.Fatalf("下发模型无法解析: %+v, %v", entry, err)
		}
	}
	t.Run("全员授权覆盖新增用户并可撤销", func(t *testing.T) {
		input := validInput()
		input.ModelID = "all-users-model"
		input.Authorization = Authorization{AllUsers: true}
		service := NewService(repo)
		item, err := service.Create(ctx, admin, input)
		if err != nil {
			t.Fatal(err)
		}
		stored, err := repo.Get(ctx, item.ID)
		if err != nil || !stored.Authorization.AllUsers || len(stored.Authorization.GroupIDs)+len(stored.Authorization.UserIDs) != 0 {
			t.Fatalf("全员授权回读错误: %+v, %v", stored.Authorization, err)
		}
		newUser := resource.ID()
		exec(`INSERT INTO users(id,name,email) VALUES($1,'新增用户','new@example.com')`, newUser)
		for _, person := range []string{user, newUser} {
			resolved, err := repo.Resolve(ctx, person, item.ID)
			if err != nil || resolved.ID != item.ID {
				t.Fatalf("用户未获得全员模型授权: %s, %v", person, err)
			}
			available, err := repo.ListAvailable(ctx, person, false)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, model := range available {
				found = found || model.ID == item.ID
			}
			if !found {
				t.Fatal("全员模型未出现在可用列表")
			}
		}
		exec(`UPDATE users SET status='disabled',disabled_at=now() WHERE id=$1`, newUser)
		if _, err := repo.Resolve(ctx, newUser, item.ID); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("停用用户仍获得全员授权: %v", err)
		}
		exec(`UPDATE users SET status='active',disabled_at=NULL WHERE id=$1`, newUser)
		input.Authorization = Authorization{UserIDs: []string{user}}
		if _, err := service.Update(ctx, item.ID, admin, input); err != nil {
			t.Fatal(err)
		}
		stored, err = repo.Get(ctx, item.ID)
		if err != nil || stored.Authorization.AllUsers {
			t.Fatalf("撤销后仍回显全员授权: %+v, %v", stored.Authorization, err)
		}
		if _, err := repo.Resolve(ctx, newUser, item.ID); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("全员授权撤销未生效: %v", err)
		}
		if _, err := repo.Resolve(ctx, user, item.ID); err != nil {
			t.Fatalf("显式用户授权受影响: %v", err)
		}
	})
}
