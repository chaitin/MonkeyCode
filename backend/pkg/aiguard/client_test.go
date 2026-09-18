package aiguard

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestScanCreatesOneTaskAndPollsSameTaskID(t *testing.T) {
	var mu sync.Mutex
	createCalls := 0
	getCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-API-Token"); got != "test-token" {
			t.Errorf("X-API-Token = %q", got)
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/scan-tasks":
			mu.Lock()
			createCalls++
			mu.Unlock()
			if err := r.ParseMultipartForm(2 << 20); err != nil {
				t.Errorf("ParseMultipartForm() error = %v", err)
			}
			if got := r.FormValue("skillName"); got != "guard-smoke" {
				t.Errorf("skillName = %q", got)
			}
			if got := r.FormValue("skillVersion"); got != "1.0.0" {
				t.Errorf("skillVersion = %q", got)
			}
			if got := r.FormValue("staticDetect"); got != "true" {
				t.Errorf("staticDetect = %q", got)
			}
			if got := r.FormValue("llmDetect"); got != "false" {
				t.Errorf("llmDetect = %q", got)
			}
			if got := r.FormValue("dynamicDetect"); got != "false" {
				t.Errorf("dynamicDetect = %q", got)
			}
			file, header, err := r.FormFile("skillPackage")
			if err != nil {
				t.Errorf("FormFile() error = %v", err)
			} else {
				_ = file.Close()
				if header.Filename != "skill.zip" {
					t.Errorf("filename = %q", header.Filename)
				}
			}
			_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"running"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/scan-tasks/task-1":
			mu.Lock()
			getCalls++
			call := getCalls
			mu.Unlock()
			if call == 1 {
				_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"running"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"completed","detectionResult":"safe"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{
		BaseURL:        server.URL,
		APIToken:       "test-token",
		RequestTimeout: "1s",
		WaitTimeout:    "1s",
		PollInterval:   "5ms",
	})
	result, err := client.Scan(context.Background(), domain.SkillGuardRequest{
		Name:     "guard-smoke",
		Version:  "1.0.0",
		Filename: "skill.zip",
		Package:  []byte("zip-bytes"),
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if result == nil || result.TaskID != "task-1" || result.Status != "completed" || result.DetectionResult != "safe" {
		t.Fatalf("result = %#v", result)
	}
	if createCalls != 1 {
		t.Fatalf("create calls = %d, want 1", createCalls)
	}
	if getCalls != 2 {
		t.Fatalf("get calls = %d, want 2", getCalls)
	}
}

func TestScanFailsClosed(t *testing.T) {
	tests := []struct {
		name       string
		postBody   string
		statusCode int
		wait       time.Duration
		wantErr    error
	}{
		{
			name:     "risk result",
			postBody: `{"data":{"taskId":"task-high","status":"completed","detectionResult":"high"}}`,
			wantErr:  ErrRejected,
		},
		{
			name:     "failed task",
			postBody: `{"data":{"taskId":"task-failed","status":"failed"}}`,
			wantErr:  ErrRejected,
		},
		{
			name:     "unknown status",
			postBody: `{"data":{"taskId":"task-unknown","status":"mystery"}}`,
			wantErr:  ErrUnavailable,
		},
		{
			name:     "missing task id",
			postBody: `{"data":{"status":"running"}}`,
			wantErr:  ErrUnavailable,
		},
		{
			name:     "invalid json",
			postBody: `not-json`,
			wantErr:  ErrUnavailable,
		},
		{
			name:       "http error",
			postBody:   `{"err":"unavailable"}`,
			statusCode: http.StatusBadGateway,
			wantErr:    ErrUnavailable,
		},
		{
			name:     "wait timeout",
			postBody: `{"data":{"taskId":"task-slow","status":"running"}}`,
			wait:     30 * time.Millisecond,
			wantErr:  ErrUnavailable,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					_, _ = w.Write([]byte(`{"data":{"taskId":"task-slow","status":"running"}}`))
					return
				}
				if tt.statusCode != 0 {
					w.WriteHeader(tt.statusCode)
				}
				_, _ = w.Write([]byte(tt.postBody))
			}))
			defer server.Close()

			wait := tt.wait
			if wait == 0 {
				wait = time.Second
			}
			client := NewClient(config.AIGuardConfig{
				BaseURL:        server.URL,
				APIToken:       "test-token",
				RequestTimeout: "1s",
				WaitTimeout:    wait.String(),
				PollInterval:   "5ms",
			})
			_, err := client.Scan(context.Background(), domain.SkillGuardRequest{
				Name:     "guard-smoke",
				Filename: "skill.zip",
				Package:  []byte("zip-bytes"),
			})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Scan() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestScanIsNotConfiguredBeforeSendingRequest(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{BaseURL: server.URL})
	_, err := client.Scan(context.Background(), domain.SkillGuardRequest{
		Name:     "guard-smoke",
		Filename: "skill.zip",
		Package:  []byte("zip-bytes"),
	})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Scan() error = %v, want ErrNotConfigured", err)
	}
	if called {
		t.Fatal("scanner request was sent without an API token")
	}
}

func TestScanTreatsCreateTaskIDOnlyAsPending(t *testing.T) {
	var gets int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"data":{"taskId":"task-1"}}`))
			return
		}
		gets++
		_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"completed","detectionResult":"safe"}}`))
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{
		BaseURL:        server.URL,
		APIToken:       "test-token",
		RequestTimeout: "1s",
		WaitTimeout:    "1s",
		PollInterval:   "5ms",
	})
	result, err := client.Scan(context.Background(), domain.SkillGuardRequest{
		Name:     "guard-smoke",
		Filename: "skill.zip",
		Package:  []byte("zip-bytes"),
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if gets != 1 || result == nil || result.DetectionResult != "safe" {
		t.Fatalf("gets = %d result = %#v", gets, result)
	}
}

func TestScanRejectsPollResponseWithDifferentTaskID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"running"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"taskId":"task-2","status":"completed","detectionResult":"safe"}}`))
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{
		BaseURL:        server.URL,
		APIToken:       "test-token",
		RequestTimeout: "1s",
		WaitTimeout:    "1s",
		PollInterval:   "5ms",
	})
	result, err := client.Scan(context.Background(), domain.SkillGuardRequest{
		Name:     "guard-smoke",
		Filename: "skill.zip",
		Package:  []byte("zip-bytes"),
	})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Scan() error = %v, want ErrUnavailable", err)
	}
	if result == nil || result.TaskID != "task-1" {
		t.Fatalf("result = %#v, want original task-1", result)
	}
}

func TestScanObservedPersistsTaskBeforeFirstPoll(t *testing.T) {
	var observed []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"running"}}`))
			return
		}
		observed = append(observed, r.URL.Path)
		_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"completed","detectionResult":"safe"}}`))
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{
		BaseURL:        server.URL,
		APIToken:       "test-token",
		RequestTimeout: "1s",
		WaitTimeout:    "1s",
		PollInterval:   "5ms",
	})
	callbackCalled := false
	result, err := client.ScanObserved(context.Background(), domain.SkillGuardRequest{
		Name:     "guard-smoke",
		Filename: "skill.zip",
		Package:  []byte("zip-bytes"),
	}, func(task *domain.SkillGuardResult) error {
		callbackCalled = true
		if task == nil || task.TaskID != "task-1" || task.Status != "running" {
			t.Fatalf("observed task = %#v", task)
		}
		if len(observed) != 0 {
			t.Fatal("callback ran after polling began")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("ScanObserved() error = %v", err)
	}
	if !callbackCalled || result == nil || result.DetectionResult != "safe" {
		t.Fatalf("callback=%v result=%#v", callbackCalled, result)
	}
}

func TestPollReturnsPendingWithoutError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"taskId":"task-1","status":"running"}}`))
	}))
	defer server.Close()

	client := NewClient(config.AIGuardConfig{
		BaseURL:        server.URL,
		APIToken:       "test-token",
		RequestTimeout: "1s",
	})
	result, err := client.Poll(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if result == nil || result.Status != "running" {
		t.Fatalf("result = %#v", result)
	}
}
