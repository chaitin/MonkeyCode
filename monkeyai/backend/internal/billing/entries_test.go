package billing

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDefaultEntryRangeShanghaiMidnight(t *testing.T) {
	for _, tc := range []struct{ now, from, until string }{
		{"2026-10-23T15:59:59Z", "2026-09-26T00:00:00+08:00", "2026-10-24T00:00:00+08:00"},
		{"2026-10-23T16:00:00Z", "2026-09-27T00:00:00+08:00", "2026-10-25T00:00:00+08:00"},
		{"2024-03-01T02:00:00Z", "2024-02-03T00:00:00+08:00", "2024-03-02T00:00:00+08:00"},
	} {
		now, err := time.Parse(time.RFC3339, tc.now)
		if err != nil {
			t.Fatal(err)
		}
		from, until := defaultEntryRange(now)
		if from.Format(time.RFC3339) != tc.from || until.Format(time.RFC3339) != tc.until {
			t.Fatalf("now=%s range=[%s,%s), want=[%s,%s)", tc.now, from, until, tc.from, tc.until)
		}
	}
}

type entryQueryTrace struct {
	mu      sync.Mutex
	queries []string
}

func (t *entryQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	t.mu.Lock()
	t.queries = append(t.queries, data.SQL)
	t.mu.Unlock()
	return ctx
}
func (*entryQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestAdminEntryWindowAndNoCount(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	account, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	from, until := defaultEntryRange(s.now())
	for _, tc := range []struct {
		name string
		at   time.Time
	}{
		{"before", from.Add(-time.Microsecond)},
		{"start", from},
		{"middle", s.now()},
		{"last", until.Add(-time.Microsecond)},
		{"after", until},
		{"older", from.AddDate(0, -1, 0)},
	} {
		if _, err := s.pool.Exec(ctx, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
			VALUES($1,$2,'charge','model',$3,-1,0,$4)`, account.ID, user, "entry-window-"+tc.name, tc.at); err != nil {
			t.Fatal(err)
		}
	}
	trace := &entryQueryTrace{}
	cfg := s.pool.Config()
	cfg.ConnConfig.Tracer = trace
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	reader := NewService(pool)
	reader.now = s.now
	router := chi.NewRouter()
	reader.RegisterAdmin(router)
	for _, tc := range []struct {
		name, query string
		want        int
		hasNext     bool
		first       string
	}{
		{"default", "", 3, false, "last"},
		{"first-page", "page_size=2", 2, true, "last"},
		{"last-page", "page_size=2&page=2", 1, false, "start"},
		{"past-last", "page_size=2&page=3", 0, false, ""},
		{"all", "range=all", 6, false, "after"},
		{"explicit", "from=" + url.QueryEscape(from.Format(time.RFC3339)) + "&until=" + url.QueryEscape(from.Add(time.Microsecond).Format(time.RFC3339Nano)), 1, false, "start"},
		{"until-only", "until=" + url.QueryEscape(from.Format(time.RFC3339)), 2, false, "before"},
		{"from-only", "from=" + url.QueryEscape(until.Format(time.RFC3339)), 1, false, "after"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", "/billing/entries?content=entry-window-&"+tc.query, nil))
			var out struct {
				Items []struct {
					Name string `json:"item_name"`
				} `json:"items"`
				Total   *int       `json:"total"`
				HasNext bool       `json:"has_next"`
				From    *time.Time `json:"from"`
				Until   *time.Time `json:"until"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || out.Total != nil || len(out.Items) != tc.want || out.HasNext != tc.hasNext {
				t.Fatalf("invalid bounded/count-free result: status=%d %s", w.Code, w.Body)
			}
			if tc.want > 0 && out.Items[0].Name != "entry-window-"+tc.first {
				t.Fatalf("order/boundary: %s", w.Body)
			}
			if tc.query == "" || strings.HasPrefix(tc.query, "page_size=") {
				if out.From == nil || !out.From.Equal(from) || out.Until == nil || !out.Until.Equal(until) {
					t.Fatalf("default range missing: %s", w.Body)
				}
			}
			if tc.name == "all" && (out.From != nil || out.Until != nil) {
				t.Fatalf("explicit all-range was restricted: %s", w.Body)
			}
			if tc.name == "until-only" && out.From != nil || tc.name == "from-only" && out.Until != nil {
				t.Fatalf("explicit one-sided range was changed: %s", w.Body)
			}
		})
	}
	for _, query := range []string{"range=month", "from=invalid", "from=" + url.QueryEscape(until.Format(time.RFC3339)) + "&until=" + url.QueryEscape(from.Format(time.RFC3339))} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/billing/entries?"+query, nil))
		if w.Code != 400 {
			t.Fatalf("invalid filter accepted: %s %d %s", query, w.Code, w.Body)
		}
	}
	trace.mu.Lock()
	defer trace.mu.Unlock()
	if len(trace.queries) != 8 {
		t.Fatalf("each page must perform exactly one query, got %d: %v", len(trace.queries), trace.queries)
	}
	for _, sql := range trace.queries {
		if strings.Contains(strings.ToLower(sql), "count(") || strings.Contains(strings.ToLower(sql), "count (") {
			t.Fatalf("ledger pagination must not count all matching rows: %s", sql)
		}
	}
}
