package stats

import (
	"fmt"
	"testing"
	"time"
)

func TestModelsOverviewTrimmedMeans(t *testing.T) {
	for _, size := range []int{1, 2, 19, 20, 21, 40, 100} {
		t.Run(fmt.Sprintf("samples_%d", size), func(t *testing.T) {
			s, user, model := fixture(t)
			removed := size / 20
			kept := size - removed
			for i := 1; i <= size; i++ {
				response, first := i*100, (size+1-i)*10
				// The two metrics have outliers on different calls and must be trimmed independently.
				if i > kept {
					response += 1_000_000
				}
				if i <= removed {
					first += 1_000_000
				}
				end := s.now().Add(-time.Duration(i) * time.Second)
				exec(t, s, `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at,response_duration_ms,first_token_duration_ms)
					VALUES($1,$2,'succeeded',$3,$4,$5,$6)`, user, model, end.Add(-time.Second), end, response, first)
			}
			out := request(t, s, "/statistics/models/overview", 200)["last_30m"].(map[string]any)
			number(t, out, "avg_response_time", float64(kept+1)*50)
			number(t, out, "avg_first_token_time", float64(kept+1)*5)
		})
	}
}

func TestModelsOverviewTrimmedMeansTies(t *testing.T) {
	for _, allEqual := range []bool{false, true} {
		t.Run(fmt.Sprintf("all_equal_%t", allEqual), func(t *testing.T) {
			s, user, model := fixture(t)
			for i := 0; i < 100; i++ {
				duration := 10
				if !allEqual && i >= 90 {
					duration = 100
				}
				end := s.now().Add(-time.Duration(i+1) * time.Second)
				exec(t, s, `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at,response_duration_ms,first_token_duration_ms)
					VALUES($1,$2,'succeeded',$3,$4,$5,$5)`, user, model, end.Add(-time.Second), end, duration)
			}
			want := 1400.0 / 95 // Keep 90 fast calls and exactly five of the ten tied slow calls.
			if allEqual {
				want = 10
			}
			out := request(t, s, "/statistics/models/overview", 200)["last_30m"].(map[string]any)
			number(t, out, "avg_response_time", want)
			number(t, out, "avg_first_token_time", want)
		})
	}
}

func TestModelsOverviewMeanSampleBoundaries(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	for _, sample := range []struct {
		status          string
		end             time.Time
		response, first any
	}{
		{"succeeded", now.Add(-30 * time.Minute), nil, 100},
		{"succeeded", now.Add(-time.Second), 0, 0},
		{"succeeded", now.Add(-2 * time.Minute), 4000, nil},
		{"succeeded", now.Add(-30*time.Minute - time.Microsecond), 9_000_000, 9_000_000},
		{"succeeded", now, 9_000_000, 9_000_000},
		{"succeeded", now.Add(time.Second), 9_000_000, 9_000_000},
		{"failed", now.Add(-time.Minute), 9_000_000, 9_000_000},
		{"cancelled", now.Add(-time.Minute), 9_000_000, 9_000_000},
		{"running", now.Add(-time.Minute), 9_000_000, 9_000_000},
	} {
		exec(t, s, `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at,response_duration_ms,first_token_duration_ms)
			VALUES($1,$2,$3,$4,$5,$6,$7)`, user, model, sample.status, sample.end.Add(-2*time.Second), sample.end, sample.response, sample.first)
	}
	out := request(t, s, "/statistics/models/overview", 200)["last_30m"].(map[string]any)
	number(t, out, "avg_response_time", 2000)
	number(t, out, "avg_first_token_time", 50)
}

func TestModelsOverviewMeanWithoutFirstToken(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	call(t, s, user, model, "succeeded", now.Add(-2*time.Minute), now.Add(-time.Minute), 10, 0, 1, 1000)
	out := request(t, s, "/statistics/models/overview", 200)["last_30m"].(map[string]any)
	number(t, out, "avg_response_time", 1000)
	if out["avg_first_token_time"] != nil {
		t.Fatalf("未采集首字耗时时应为 null: %v", out)
	}
}
