package server

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/mail"
	"os"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/jackc/pgx/v5"
)

// Reset 重置现有管理员的密码，成功提交后将账号和新密码写入 output。
func Reset(ctx context.Context, args []string, input io.Reader, output io.Writer) error {
	url := strings.TrimSpace(os.Getenv("MONKEYAI_DATABASE_URL"))
	flags := flag.NewFlagSet("monkeyai-server reset", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&url, "database-url", url, "PostgreSQL 连接地址")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			PrintResetUsage(output)
			return nil
		}
		return errors.New("reset 参数无效，请使用 reset --help 查看用法")
	}
	if flags.NArg() != 0 {
		return errors.New("reset 参数无效，请使用 reset --help 查看用法")
	}
	if strings.TrimSpace(url) == "" {
		return errors.New("MONKEYAI_DATABASE_URL 或 --database-url 不能为空")
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		return errors.New("无法连接数据库，请检查 MONKEYAI_DATABASE_URL 或 --database-url")
	}
	defer pool.Close()

	email := "admin@baizhi.cloud"
	scanner := bufio.NewScanner(input)
	for {
		password, err := identity.ResetAdminPassword(ctx, pool, email)
		if err == nil {
			_, err = fmt.Fprintf(output, "密码重置成功\n账号: %s\n密码: %s\n", email, password)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("重置管理员密码: %w", err)
		}
		if _, err := fmt.Fprintf(output, "未找到管理员 %s，请填写一个管理员的邮箱：", email); err != nil {
			return err
		}
		for {
			if !scanner.Scan() {
				if err := scanner.Err(); err != nil {
					return fmt.Errorf("读取管理员邮箱: %w", err)
				}
				return errors.New("未输入管理员邮箱，密码未重置")
			}
			email = strings.ToLower(strings.TrimSpace(scanner.Text()))
			address, err := mail.ParseAddress(email)
			if err == nil && address.Address == email {
				break
			}
			if _, err := io.WriteString(output, "请输入有效的管理员邮箱："); err != nil {
				return err
			}
		}
	}
}

func PrintResetUsage(output io.Writer) {
	_, _ = io.WriteString(output, "用法: monkeyai-server reset [--database-url PostgreSQL连接地址]\n优先重置 admin@baizhi.cloud；未找到时提示填写管理员邮箱。\n数据库连接默认读取 MONKEYAI_DATABASE_URL，成功后输出账号和随机新密码。\n")
}
