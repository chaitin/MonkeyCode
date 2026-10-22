package logging

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"os"
	"sync"
	"time"
)

type Settings struct {
	Enabled bool
	Window  time.Duration
	MaxKeys int
}

func DefaultSettings() Settings { return Settings{Enabled: true, Window: time.Minute, MaxKeys: 4096} }
func (s Settings) Validate() error {
	if s.Window < time.Second || s.Window > 10*time.Minute || s.MaxKeys < 128 || s.MaxKeys > 65536 {
		return errors.New("日志去重窗口或容量超出允许范围")
	}
	return nil
}

type Snapshot struct {
	Candidates, Details, Suppressed, Summaries, Overflow, OutputErrors uint64
	Calls, FailedCalls                                                 uint64
	Requests, FailedRequests                                           uint64
	ActiveKeys                                                         int
}

type entry struct {
	key                           string
	fields                        []slog.Attr
	level                         slog.Level
	event, fingerprint            string
	start, end, first, last, idle time.Time
	window                        time.Duration
	count, details                uint64
	samples                       []string
	sampleKey                     string
	idleRound                     bool
}

type Runtime struct {
	mu          sync.Mutex
	settings    Settings
	output      slog.Handler
	logger      *slog.Logger
	entries     map[string]*entry
	stats       Snapshot
	now         func() time.Time
	stop, done  chan struct{}
	closed      bool
	closeOnce   sync.Once
	lastWarning time.Time
}

// NewRuntime creates one scheduler and state container shared by all derived
// loggers. Its owner must close it after business workers and final events.
func NewRuntime(output io.Writer, level slog.Leveler, settings Settings) (*Runtime, error) {
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	r := &Runtime{settings: settings, entries: make(map[string]*entry), now: time.Now,
		stop: make(chan struct{}), done: make(chan struct{})}
	r.output = jsonHandler(output, level)
	r.logger = slog.New(&safeHandler{next: r.output, runtime: r})
	go func() {
		defer close(r.done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.stop:
				return
			case <-ticker.C:
				r.Flush()
			}
		}
	}()
	return r, nil
}

func CountCall(logger *slog.Logger, result string) {
	if r := runtimeFor(logger); r != nil {
		r.mu.Lock()
		r.stats.Calls++
		if result == "failed" {
			r.stats.FailedCalls++
		}
		r.mu.Unlock()
	}
}

func (r *Runtime) Logger() *slog.Logger { return r.logger }
func (r *Runtime) Snapshot() Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.stats
	s.ActiveKeys = len(r.entries)
	return s
}

func (r *Runtime) emit(ctx context.Context, record slog.Record) error {
	err := r.output.Handle(ctx, record)
	if err != nil {
		r.mu.Lock()
		r.stats.OutputErrors++
		now := r.now()
		warn := r.lastWarning.IsZero() || now.Sub(r.lastWarning) >= time.Minute
		if warn {
			r.lastWarning = now
		}
		r.mu.Unlock()
		if warn {
			_, _ = io.WriteString(os.Stderr, "结构化日志输出失败\n")
		}
	}
	return err
}

func (r *Runtime) submit(ctx context.Context, record slog.Record) error {
	fields := scalars(record)
	event := fields["event"].Value.String()
	policy, registered := policies[event]
	key := ""
	var safeFields []slog.Attr
	if registered && r.settings.Enabled {
		key, safeFields = fingerprint(record.Level, fields, policy)
	}
	r.mu.Lock()
	r.stats.Candidates++
	if !r.settings.Enabled || !registered || key == "" || r.closed {
		r.stats.Details++
		r.mu.Unlock()
		return r.emit(ctx, record)
	}
	now := r.now()
	var pending []slog.Record
	e := r.entries[key]
	if e != nil && !now.Before(e.end) {
		empty := e.count == 0
		if summary, ok := r.settle(e, "window"); ok {
			pending = append(pending, summary)
		}
		if empty || now.Sub(e.end) >= e.window {
			e.idleRound = true
			e.start, e.end = now, now.Add(e.window)
		} else {
			e.start = e.end
			e.end = e.start.Add(e.window)
		}
	}
	if e == nil {
		if len(r.entries) >= r.settings.MaxKeys {
			for k, old := range r.entries {
				ttl := max(10*time.Minute, 2*old.window)
				if old.count == 0 && now.Sub(old.idle) >= ttl {
					delete(r.entries, k)
				}
			}
		}
		if len(r.entries) >= r.settings.MaxKeys {
			r.stats.Overflow++
			overflow := r.stats.Overflow
			r.stats.Details++
			warn := r.lastWarning.IsZero() || now.Sub(r.lastWarning) >= time.Minute
			if warn {
				r.lastWarning = now
			}
			r.mu.Unlock()
			for _, p := range pending {
				_ = r.emit(ctx, p)
			}
			if warn {
				warning := slog.NewRecord(now, slog.LevelWarn, "日志去重容量已满", 0)
				warning.AddAttrs(slog.String("event", "logging.capacity.exceeded"), slog.Uint64("overflow_count", overflow))
				if r.output.Enabled(ctx, warning.Level) {
					_ = r.emit(ctx, warning)
				}
			}
			return r.emit(ctx, record)
		}
		window := max(r.settings.Window, policy.window)
		hash := sha256.Sum256([]byte(key))
		e = &entry{key: key, fields: safeFields, level: record.Level, event: event,
			fingerprint: hex.EncodeToString(hash[:16]), start: now, end: now.Add(window), window: window,
			details: 1, sampleKey: policy.sample}
		r.entries[key] = e
		r.stats.Details++
	} else {
		if e.idleRound {
			e.details = 1
			e.idleRound = false
			e.start, e.end = now, now.Add(e.window)
			r.stats.Details++
		} else {
			r.stats.Suppressed++
		}
	}
	e.count++
	if e.first.IsZero() {
		e.first = now
	}
	e.last, e.idle = now, now
	if sample, ok := fields[policy.sample]; ok && sample.Value.String() != "" && len(e.samples) < 3 {
		value := sample.Value.String()
		found := false
		for _, previous := range e.samples {
			if previous == value {
				found = true
			}
		}
		if !found {
			e.samples = append(e.samples, value)
		}
	}
	detail := e.count == 1 && e.details == 1
	r.mu.Unlock()
	for _, p := range pending {
		_ = r.emit(ctx, p)
	}
	if detail {
		return r.emit(ctx, record)
	}
	return nil
}

// settle is called under mu. Filtering still settles the window; discarded
// summaries are never replayed after a runtime level change.
func (r *Runtime) settle(e *entry, reason string) (slog.Record, bool) {
	defer func() { e.count, e.details = 0, 0; e.first = time.Time{}; e.samples = nil }()
	if e.count <= e.details || !r.output.Enabled(context.Background(), e.level) {
		return slog.Record{}, false
	}
	ended := e.end
	if reason != "window" && r.now().Before(ended) {
		ended = r.now()
	}
	record := slog.NewRecord(r.now(), e.level, "重复故障汇总", 0)
	record.AddAttrs(e.fields...)
	record.AddAttrs(slog.String("event", "logging.error.summary"), slog.String("original_event", e.event),
		slog.String("original_level", e.level.String()), slog.String("fingerprint", e.fingerprint),
		slog.Time("window_started_at", e.start), slog.Time("window_ended_at", ended),
		slog.Float64("window_seconds", e.window.Seconds()), slog.String("flush_reason", reason),
		slog.Time("first_seen_at", e.first), slog.Time("last_seen_at", e.last),
		slog.Uint64("occurrence_count", e.count), slog.Uint64("detail_count", e.details),
		slog.Uint64("suppressed_count", e.count-e.details))
	if len(e.samples) > 0 {
		// The only collection retained by deduplication is a bounded list of
		// validated scalar IDs; no errors, records or contexts are retained.
		record.AddAttrs(slog.Any("sample_"+e.sampleKey+"s", append([]string(nil), e.samples...)))
	}
	r.stats.Summaries++
	return record, true
}

func (r *Runtime) drain(all bool, reason string) {
	r.mu.Lock()
	now := r.now()
	var pending []slog.Record
	for key, e := range r.entries {
		if all || !now.Before(e.end) {
			empty := e.count == 0
			if summary, ok := r.settle(e, reason); ok {
				pending = append(pending, summary)
			}
			if all {
				delete(r.entries, key)
				continue
			}
			if now.Sub(e.idle) >= max(10*time.Minute, 2*e.window) {
				delete(r.entries, key)
			} else {
				if empty || now.Sub(e.end) >= e.window {
					e.idleRound = true
					e.start, e.end = now, now.Add(e.window)
				} else {
					e.start = e.end
					e.end = e.start.Add(e.window)
				}
			}
		}
	}
	r.mu.Unlock()
	for _, record := range pending {
		_ = r.emit(context.Background(), record)
	}
}

func (r *Runtime) Flush() { r.drain(false, "window") }
func (r *Runtime) Close() error {
	r.closeOnce.Do(func() {
		close(r.stop)
		<-r.done
		r.mu.Lock()
		r.closed = true
		r.mu.Unlock()
		r.drain(true, "shutdown")
	})
	return nil
}

// Recovered ends exactly the selected failure scope. The observing worker,
// rather than silence in the log, decides when a dependency has recovered.
func (r *Runtime) Recovered(ctx context.Context, event string, fields ...slog.Attr) {
	scope := slog.NewRecord(r.now(), slog.LevelWarn, "", 0)
	scope.AddAttrs(fields...)
	scope.AddAttrs(slog.String("event", event))
	values := scalars(scope)
	r.mu.Lock()
	var pending []slog.Record
	for key, e := range r.entries {
		if e.event != event {
			continue
		}
		match := true
		for _, a := range e.fields {
			if a.Key == "event" || a.Key == "error_code" || a.Key == "error_type" || a.Key == "sqlstate" {
				continue
			}
			if value, ok := values[a.Key]; !ok || !value.Equal(a) {
				match = false
				break
			}
		}
		if match {
			if record, ok := r.settle(e, "recovered"); ok {
				pending = append(pending, record)
			}
			delete(r.entries, key)
		}
	}
	r.mu.Unlock()
	for _, record := range pending {
		_ = r.emit(ctx, record)
	}
}
