package gitee

import (
	"errors"
	"fmt"
	"testing"
)

// fakeFetcher 模拟一个共有 total 个仓库的后端，按 page/perPage 返回对应切片，
// 并记录被调用的次数，用于验证翻页/截断/上限逻辑。
func fakeFetcher(total int, calls *int) func(page, perPage int) ([]*Repository, error) {
	return func(page, perPage int) ([]*Repository, error) {
		*calls++
		start := (page - 1) * perPage
		if start >= total {
			return []*Repository{}, nil
		}
		end := min(start+perPage, total)
		out := make([]*Repository, 0, end-start)
		for i := start; i < end; i++ {
			out = append(out, &Repository{FullName: fmt.Sprintf("o/r%d", i)})
		}
		return out, nil
	}
}

func TestCollectAllRepos(t *testing.T) {
	cases := []struct {
		name      string
		total     int
		wantCount int
		wantCalls int
	}{
		{name: "empty", total: 0, wantCount: 0, wantCalls: 1},
		{name: "less than one page", total: 30, wantCount: 30, wantCalls: 1},
		// 恰好整页：第 1 页满 100 → 继续；第 2 页空 → 停。验证不会漏也不会死循环。
		{name: "exactly one full page", total: 100, wantCount: 100, wantCalls: 2},
		// 关键回归点：>100 不再被截断，需翻 3 页（100/100/50）取全。
		{name: "multiple pages no truncation", total: 250, wantCount: 250, wantCalls: 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			got, err := collectAllRepos(fakeFetcher(tc.total, &calls))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tc.wantCount {
				t.Errorf("count = %d, want %d", len(got), tc.wantCount)
			}
			if calls != tc.wantCalls {
				t.Errorf("calls = %d, want %d", calls, tc.wantCalls)
			}
		})
	}
}

// 安全上限：每页都满 100 时，最多翻 50 页（5000 个）后停止，避免无限翻页。
func TestCollectAllRepos_SafetyCap(t *testing.T) {
	calls := 0
	got, err := collectAllRepos(fakeFetcher(10000, &calls))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 5000 {
		t.Errorf("count = %d, want 5000 (capped)", len(got))
	}
	if calls != 50 {
		t.Errorf("calls = %d, want 50 (capped)", calls)
	}
}

// 拉取出错时应直接向上传播，不吞错。
func TestCollectAllRepos_Error(t *testing.T) {
	wantErr := errors.New("boom")
	calls := 0
	_, err := collectAllRepos(func(page, perPage int) ([]*Repository, error) {
		calls++
		if page == 2 {
			return nil, wantErr
		}
		out := make([]*Repository, perPage) // 满页，强制翻到第 2 页
		for i := range out {
			out[i] = &Repository{FullName: fmt.Sprintf("o/r%d", i)}
		}
		return out, nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want %v", err, wantErr)
	}
	if calls != 2 {
		t.Errorf("calls = %d, want 2", calls)
	}
}
