package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestArgumentErrors(t *testing.T) {
	for _, args := range [][]string{nil, {"unknown"}, {"version", "extra"}, {"doctor", "--data-dir", "relative"}, {"doctor", "--architecture", "x86"}, {"validate-preset"}, {"validate-preset", "--file", "a", "extra"}} {
		var out, err bytes.Buffer
		if code := run(t.Context(), args, &out, &err); code != 2 {
			t.Fatalf("%v: 期望退出码 2，得到 %d", args, code)
		}
	}
}

func TestDoctorReport(t *testing.T) {
	var out, stderr bytes.Buffer
	code := run(t.Context(), []string{"doctor", "--data-dir", "/nonexistent/monkeyai-engine-test"}, &out, &stderr)
	if code != 1 {
		t.Fatalf("不存在的数据目录应拒绝：%d %s", code, stderr.String())
	}
	var result struct {
		Prerequisites bool `json:"prerequisites_met"`
		Workload      bool `json:"workload_verified"`
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Prerequisites || result.Workload {
		t.Fatal("失败预检不能报告已验证")
	}
	if strings.Contains(out.String(), "PRIVATE KEY") {
		t.Fatal("不应输出凭据")
	}
}
