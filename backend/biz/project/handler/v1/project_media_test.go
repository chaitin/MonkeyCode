package v1

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

var testPNG = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
var testJPEG = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0}

func TestProjectMediaReturnsInlinePNG(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	projectID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	stub := &projectMediaUsecaseStub{
		blob: &domain.ProjectBlob{Content: testPNG, Sha: "png-sha", Size: len(testPNG)},
	}
	h := &ProjectHandler{usecase: stub}
	w := web.New()
	w.GET("/api/v1/users/projects/:id/tree/media", web.BindHandler(h.GetProjectMedia), projectMediaUser(userID))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/projects/"+projectID.String()+"/tree/media?path=docs%2Fdemo.png&ref=main", nil)
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Equal(rec.Body.Bytes(), testPNG) {
		t.Fatalf("body = %v, want PNG bytes", rec.Body.Bytes())
	}
	if got := rec.Header().Get(echo.HeaderContentType); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
	if got := rec.Header().Get(echo.HeaderContentDisposition); got != `inline; filename=demo.png` {
		t.Fatalf("Content-Disposition = %q", got)
	}
	if got := rec.Header().Get(echo.HeaderContentLength); got != "12" {
		t.Fatalf("Content-Length = %q, want 12", got)
	}
	if got := rec.Header().Get(echo.HeaderCacheControl); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("ETag"); got != `"png-sha"` {
		t.Fatalf("ETag = %q", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if stub.uid != userID || stub.req == nil || stub.req.ID != projectID || stub.req.Path != "docs/demo.png" || stub.req.Ref != "main" || stub.req.MaxSize != maxProjectMediaSize {
		t.Fatalf("usecase request = uid %s, req %#v", stub.uid, stub.req)
	}
}

func TestProjectMediaDetectsJPEGContentBehindPNGFilename(t *testing.T) {
	h := &ProjectHandler{usecase: &projectMediaUsecaseStub{
		blob: &domain.ProjectBlob{Content: testJPEG, Sha: "jpeg-sha", Size: len(testJPEG)},
	}}
	w := web.New()
	w.GET("/projects/:id/tree/media", web.BindHandler(h.GetProjectMedia), projectMediaUser(uuid.New()))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/projects/"+uuid.NewString()+"/tree/media?path=demo.png", nil)
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get(echo.HeaderContentType); got != "image/jpeg" {
		t.Fatalf("Content-Type = %q, want image/jpeg", got)
	}
}

func TestProjectMediaReturnsNotModifiedForMatchingETag(t *testing.T) {
	stub := &projectMediaUsecaseStub{
		blob: &domain.ProjectBlob{Content: testPNG, Sha: "png-sha", Size: len(testPNG)},
	}
	h := &ProjectHandler{usecase: stub}
	w := web.New()
	w.GET("/projects/:id/tree/media", web.BindHandler(h.GetProjectMedia), projectMediaUser(uuid.New()))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/projects/"+uuid.NewString()+"/tree/media?path=demo.png", nil)
	req.Header.Set("If-None-Match", `"png-sha"`)
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotModified {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 body = %q, want empty", rec.Body.String())
	}
}

func TestProjectMediaRejectsUnsafeOrOversizedContent(t *testing.T) {
	tests := []struct {
		name       string
		blob       *domain.ProjectBlob
		wantStatus int
	}{
		{name: "HTML with png extension", blob: &domain.ProjectBlob{Content: []byte("<!doctype html><script>alert(1)</script>"), Size: 40}, wantStatus: http.StatusUnsupportedMediaType},
		{name: "SVG", blob: &domain.ProjectBlob{Content: []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), Size: 43}, wantStatus: http.StatusUnsupportedMediaType},
		{name: "oversized image", blob: &domain.ProjectBlob{Content: testPNG, Size: maxProjectMediaSize + 1}, wantStatus: http.StatusRequestEntityTooLarge},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &ProjectHandler{usecase: &projectMediaUsecaseStub{blob: tt.blob}}
			w := web.New()
			w.GET("/projects/:id/tree/media", web.BindHandler(h.GetProjectMedia), projectMediaUser(uuid.New()))

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/projects/"+uuid.NewString()+"/tree/media?path=demo.png", nil)
			w.Echo().ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestProjectMediaRejectsPathOutsideRepository(t *testing.T) {
	stub := &projectMediaUsecaseStub{blob: &domain.ProjectBlob{Content: testPNG}}
	h := &ProjectHandler{usecase: stub}
	w := web.New()
	w.GET("/projects/:id/tree/media", web.BindHandler(h.GetProjectMedia), projectMediaUser(uuid.New()))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/projects/"+uuid.NewString()+"/tree/media?path=..%2Fsecret.png", nil)
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if stub.req != nil {
		t.Fatalf("usecase received unsafe path: %#v", stub.req)
	}
}

type projectMediaUsecaseStub struct {
	domain.ProjectUsecase
	blob *domain.ProjectBlob
	uid  uuid.UUID
	req  *domain.GetProjectBlobReq
}

func (s *projectMediaUsecaseStub) GetProjectBlob(_ context.Context, uid uuid.UUID, req *domain.GetProjectBlobReq) (*domain.ProjectBlob, error) {
	s.uid = uid
	reqCopy := *req
	s.req = &reqCopy
	return s.blob, nil
}

func projectMediaUser(userID uuid.UUID) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			middleware.SetUser(c, &domain.User{ID: userID})
			return next(c)
		}
	}
}
