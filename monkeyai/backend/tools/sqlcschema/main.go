package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var ddl = regexp.MustCompile(`(?is)^\s*(CREATE\s+(UNLOGGED\s+)?|ALTER\s+|DROP\s+)(TABLE|TYPE|DOMAIN|SEQUENCE)\s`)
var dollar = regexp.MustCompile(`^\$[a-zA-Z_0-9]*\$`)

func main() {
	check := flag.Bool("check", false, "检查结构文件是否与迁移一致")
	flag.Parse()
	if err := run(*check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(check bool) error {
	files, err := filepath.Glob("migrations/*.up.sql")
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("未找到迁移文件，请在 backend 目录运行")
	}
	var schema strings.Builder
	schema.WriteString("-- 从 migrations 自动提取；请勿手工修改。\n")
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		statements, err := split(string(data))
		if err != nil {
			return fmt.Errorf("%s: %w", file, err)
		}
		for _, statement := range statements {
			if ddl.MatchString(statement) {
				schema.WriteString("\n" + strings.TrimSpace(statement) + ";\n")
			}
		}
	}
	const path = "schema/schema.sql"
	data := []byte(schema.String())
	if check {
		current, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !bytes.Equal(current, data) {
			return fmt.Errorf("%s 与迁移不一致，请运行 make generate", path)
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// 数据迁移和临时表不参与 sqlc 的结构分析；分号可以出现在字符串和函数体中。
func split(sql string) ([]string, error) {
	var statements []string
	var statement strings.Builder
	for i := 0; i < len(sql); {
		switch {
		case strings.HasPrefix(sql[i:], "--"):
			end := strings.IndexByte(sql[i:], '\n')
			if end < 0 {
				i = len(sql)
			} else {
				i += end + 1
			}
			statement.WriteByte('\n')
		case strings.HasPrefix(sql[i:], "/*"):
			depth := 1
			i += 2
			for i < len(sql) && depth > 0 {
				switch {
				case strings.HasPrefix(sql[i:], "/*"):
					depth++
					i += 2
				case strings.HasPrefix(sql[i:], "*/"):
					depth--
					i += 2
				default:
					i++
				}
			}
			if depth != 0 {
				return nil, fmt.Errorf("块注释未闭合")
			}
			statement.WriteByte(' ')
		case sql[i] == '\'' || sql[i] == '"':
			start, quote := i, sql[i]
			escaped := quote == '\'' && i > 0 && (sql[i-1] == 'E' || sql[i-1] == 'e')
			i++
			closed := false
			for i < len(sql) {
				if escaped && sql[i] == '\\' && i+1 < len(sql) {
					i += 2
					continue
				}
				if sql[i] == quote {
					i++
					if i < len(sql) && sql[i] == quote {
						i++
						continue
					}
					closed = true
					break
				}
				i++
			}
			if !closed {
				return nil, fmt.Errorf("引号未闭合")
			}
			statement.WriteString(sql[start:i])
		case sql[i] == '$' && dollar.FindString(sql[i:]) != "":
			tag := dollar.FindString(sql[i:])
			end := strings.Index(sql[i+len(tag):], tag)
			if end < 0 {
				return nil, fmt.Errorf("函数体 %s 未闭合", tag)
			}
			end += i + 2*len(tag)
			statement.WriteString(sql[i:end])
			i = end
		case sql[i] == ';':
			statements = append(statements, strings.TrimSpace(statement.String()))
			statement.Reset()
			i++
		default:
			statement.WriteByte(sql[i])
			i++
		}
	}
	if strings.TrimSpace(statement.String()) != "" {
		return nil, fmt.Errorf("SQL 语句缺少结尾分号")
	}
	return statements, nil
}
