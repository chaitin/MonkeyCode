package resource

import (
	"net/http"
	"strconv"
)

func PageParams(r *http.Request) (page, size int, err error) {
	page, size = 1, 20
	for _, field := range []struct {
		name  string
		value *int
		max   int
	}{{"page", &page, 1000000}, {"page_size", &size, 100}} {
		if raw := r.URL.Query().Get(field.name); raw != "" {
			n, parseErr := strconv.Atoi(raw)
			if parseErr != nil || n < 1 || n > field.max {
				return 0, 0, Invalid(field.name + " 无效")
			}
			*field.value = n
		}
	}
	return page, size, nil
}

func PageSlice[T any](items []T, page, size int) []T {
	start := (page - 1) * size
	if start >= len(items) {
		return items[:0]
	}
	end := min(start+size, len(items))
	return items[start:end]
}
