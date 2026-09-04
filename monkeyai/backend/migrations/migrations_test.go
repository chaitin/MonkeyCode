package migrations

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var migrationName = regexp.MustCompile(`^(\d{6})_([a-z0-9]+(?:_[a-z0-9]+)*)\.(up|down)\.sql$`)

func TestMigrations(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}

	versions := make(map[string]string)
	pairs := make(map[string]map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}

		matches := migrationName.FindStringSubmatch(entry.Name())
		if matches == nil {
			t.Errorf("迁移文件名不符合约定: %s", entry.Name())
			continue
		}

		version, name, direction := matches[1], matches[2], matches[3]
		if existing, ok := versions[version]; ok && existing != name {
			t.Errorf("迁移版本 %s 同时用于 %s 和 %s", version, existing, name)
		}
		versions[version] = name

		key := version + "_" + name
		if pairs[key] == nil {
			pairs[key] = make(map[string]bool)
		}
		pairs[key][direction] = true

		content, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Errorf("读取 %s: %v", entry.Name(), err)
			continue
		}
		if strings.Contains(strings.ToLower(string(content)), "varchar") {
			t.Errorf("%s 使用了 varchar，应统一使用 text", entry.Name())
		}
	}

	for key, directions := range pairs {
		if !directions["up"] || !directions["down"] {
			t.Errorf("迁移 %s 的 up/down 文件不完整", key)
		}
	}
}
