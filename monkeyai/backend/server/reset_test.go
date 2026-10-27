package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func resetDatabase(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行 reset 命令集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_reset_" + strings.ToLower(rand.Text())
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	dsn = parsed.String()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, err := filepath.Glob("../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	return pool, dsn
}

func TestReset(t *testing.T) {
	pool, dsn := resetDatabase(t)
	t.Setenv("MONKEYAI_DATABASE_URL", dsn)
	// 恢复命令不依赖其他服务的配置。
	t.Setenv("MONKEYAI_PUBLIC_URL", "invalid")
	t.Setenv("MONKEYAI_INITIAL_ADMIN_EMAIL", "incomplete@example.com")
	t.Setenv("MONKEYAI_INITIAL_ADMIN_PASSWORD", "")
	for _, tc := range []struct {
		name         string
		defaultAdmin bool
		input        string
		wantEmail    string
		wantErr      bool
	}{
		{name: "默认管理员", defaultAdmin: true, input: "other@example.com\n", wantEmail: "admin@baizhi.cloud"},
		{name: "输入管理员", input: "  OTHER@EXAMPLE.COM  \n", wantEmail: "other@example.com"},
		{name: "重新输入", input: "invalid\nmissing@example.com\nregular@example.com\nother@example.com\n", wantEmail: "other@example.com"},
		{name: "空输入", wantErr: true},
		{name: "错误邮箱后结束", input: "invalid\n", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			if _, err := pool.Exec(ctx, `DELETE FROM users;
				INSERT INTO users(name,email,role,password_hash) VALUES
				('其他管理员','other@example.com','admin','original-hash'),
				('普通用户','regular@example.com','user','original-hash')`); err != nil {
				t.Fatal(err)
			}
			if tc.defaultAdmin {
				if _, err := pool.Exec(ctx, `INSERT INTO users(name,email,role,password_hash) VALUES('初始管理员','admin@baizhi.cloud','admin','original-hash')`); err != nil {
					t.Fatal(err)
				}
			}
			var output bytes.Buffer
			err := Reset(ctx, nil, strings.NewReader(tc.input), &output)
			if (err != nil) != tc.wantErr {
				t.Fatalf("命令结果: %v", err)
			}
			text := output.String()
			if tc.wantErr {
				if strings.Contains(text, "密码:") || strings.Contains(text, "重置成功") {
					t.Fatal("失败后输出了成功结果")
				}
			} else {
				if !strings.Contains(text, "账号: "+tc.wantEmail+"\n") || !regexp.MustCompile(`密码: [0-9A-Za-z]{16}\n`).MatchString(text) {
					t.Fatal("未输出预期账号及随机密码")
				}
				if tc.defaultAdmin == strings.Contains(text, "请填写") {
					t.Fatal("默认管理员查询与提示行为错误")
				}
			}
			rows, err := pool.Query(ctx, `SELECT email,password_hash FROM users`)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			for rows.Next() {
				var email, hash string
				if err := rows.Scan(&email, &hash); err != nil {
					t.Fatal(err)
				}
				wantChanged := !tc.wantErr && email == tc.wantEmail
				if (hash != "original-hash") != wantChanged {
					t.Fatalf("账号密码修改范围错误: %s", email)
				}
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestResetFlags(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	for _, tc := range []struct {
		name    string
		args    []string
		wantErr bool
	}{
		{name: "帮助", args: []string{"--help"}},
		{name: "缺少数据库", wantErr: true},
		{name: "未知参数", args: []string{"--unknown=private-secret"}, wantErr: true},
		{name: "多余位置参数", args: []string{"private-secret"}, wantErr: true},
		{name: "连接参数无效", args: []string{"--database-url", "private-secret"}, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			err := Reset(t.Context(), tc.args, strings.NewReader(""), &output)
			if (err != nil) != tc.wantErr {
				t.Fatalf("参数处理结果: %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "private-secret") {
				t.Fatal("参数错误泄露了输入内容")
			}
			if !tc.wantErr && !strings.Contains(output.String(), "monkeyai-server reset") {
				t.Fatal("缺少 reset 帮助")
			}
		})
	}
}

func TestEmbeddedResetCommand(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	args := []string{"reset", "--database-url", "postgres://test", "--help"}
	if _, err := ParseLogLevel([]string{"reset", "--database-url", "postgres://test"}); err != nil {
		t.Fatalf("嵌入入口未识别 reset: %v", err)
	}
	if _, err := ParseLogLevel([]string{"reset"}); err != nil {
		t.Fatalf("日志级别解析未识别 reset: %v", err)
	}
	if err := Run(t.Context(), args, nil, nil); err != nil {
		t.Fatalf("reset 命令依赖完整服务初始化: %v", err)
	}
}
