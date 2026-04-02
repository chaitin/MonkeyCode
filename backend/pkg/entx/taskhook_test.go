package entx

import "testing"

func TestTaskConcurrencyExceeded(t *testing.T) {
	tests := []struct {
		name  string
		count int
		limit int
		want  bool
	}{
		{name: "default limit allows zero active tasks", count: 0, limit: 0, want: false},
		{name: "default limit rejects one active task", count: 1, limit: 0, want: true},
		{name: "under limit allowed", count: 2, limit: 3, want: false},
		{name: "equal to limit rejected", count: 3, limit: 3, want: true},
		{name: "over limit rejected", count: 4, limit: 3, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := taskConcurrencyExceeded(tt.count, tt.limit); got != tt.want {
				t.Fatalf("taskConcurrencyExceeded(%d, %d) = %v, want %v", tt.count, tt.limit, got, tt.want)
			}
		})
	}
}
