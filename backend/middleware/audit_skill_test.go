package middleware

import (
	"bytes"
	"context"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
)

func TestSkillAuditMiddlewarePersistsFailedMultipartAttemptWithoutBody(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("name", "guarded-skill"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "guarded-skill.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("TOP-SECRET-PACKAGE-BODY")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	repo := &auditUsecaseStub{}
	audit := NewAuditMiddleware(slog.Default(), repo, nil)
	context := newAuditTestContext(t, http.MethodPost, body.Bytes(), writer.FormDataContentType())
	handler := audit.Audit("add_team_skill_package")(func(c echo.Context) error {
		auditmeta.SetGuardResult(c.Request().Context(), &domain.SkillGuardResult{
			TaskID:          "task-high",
			Status:          "completed",
			DetectionResult: "high",
			TraceID:         "trace-high",
		})
		return aiguard.ErrRejected
	})

	err = handler(context)
	if err == nil {
		t.Fatal("handler error was swallowed")
	}
	records := repo.Records()
	if len(records) != 1 {
		t.Fatalf("audit records = %d, want 1", len(records))
	}
	record := records[0]
	if strings.Contains(record.Request, "TOP-SECRET-PACKAGE-BODY") || strings.Contains(record.Response, "TOP-SECRET-PACKAGE-BODY") {
		t.Fatalf("audit leaked package body: request=%s response=%s", record.Request, record.Response)
	}
	if !strings.Contains(record.Request, `"filename":"guarded-skill.zip"`) {
		t.Fatalf("audit request missing filename: %s", record.Request)
	}
	if !strings.Contains(record.Response, `"code":"guard_rejected"`) || !strings.Contains(record.Response, `"task_id":"task-high"`) || !strings.Contains(record.Response, `"detection_result":"high"`) {
		t.Fatalf("audit response = %s", record.Response)
	}
}

func TestSkillAuditMiddlewareRedactsSuccessfulJSONContent(t *testing.T) {
	requestBody := []byte(`{"name":"guarded-skill","description":"guarded","content":"TOP-SECRET-SKILL-CONTENT"}`)
	repo := &auditUsecaseStub{}
	audit := NewAuditMiddleware(slog.Default(), repo, nil)
	context := newAuditTestContext(t, http.MethodPost, requestBody, "application/json")
	handler := audit.Audit("add_team_skill")(func(c echo.Context) error {
		auditmeta.SetGuardResult(c.Request().Context(), &domain.SkillGuardResult{
			TaskID:          "task-safe",
			Status:          "completed",
			DetectionResult: "safe",
		})
		_, err := c.Response().Write([]byte(`{"code":0,"data":{"name":"guarded-skill","content":"TOP-SECRET-SKILL-CONTENT"}}`))
		return err
	})

	if err := handler(context); err != nil {
		t.Fatalf("handler error = %v", err)
	}
	records := repo.Records()
	if len(records) != 1 {
		t.Fatalf("audit records = %d, want 1", len(records))
	}
	record := records[0]
	if strings.Contains(record.Request, "TOP-SECRET-SKILL-CONTENT") || strings.Contains(record.Response, "TOP-SECRET-SKILL-CONTENT") {
		t.Fatalf("audit leaked Skill content: request=%s response=%s", record.Request, record.Response)
	}
	if !strings.Contains(record.Request, `"content_bytes":24`) || !strings.Contains(record.Request, `"content_sha256":"`) {
		t.Fatalf("audit request missing content digest: %s", record.Request)
	}
	if !strings.Contains(record.Response, `"success":true`) || !strings.Contains(record.Response, `"detection_result":"safe"`) {
		t.Fatalf("audit response = %s", record.Response)
	}
}

func newAuditTestContext(t *testing.T, method string, body []byte, contentType string) echo.Context {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(method, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	SetTeamUser(c, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	})
	return c
}

type auditUsecaseStub struct {
	mu      sync.Mutex
	records []*domain.Audit
}

func (s *auditUsecaseStub) CreateAudit(_ context.Context, audit *domain.Audit) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := *audit
	s.records = append(s.records, &copy)
	return nil
}

func (s *auditUsecaseStub) ListAudits(context.Context, *domain.TeamUser, *domain.ListAuditsRequest) (*domain.ListAuditsResponse, error) {
	return &domain.ListAuditsResponse{}, nil
}

func (s *auditUsecaseStub) Records() []*domain.Audit {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]*domain.Audit(nil), s.records...)
}

var _ domain.AuditUsecase = (*auditUsecaseStub)(nil)
