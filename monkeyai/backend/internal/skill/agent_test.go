package skill

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAgentRoutesKeepCatalog(t *testing.T) {
	router := chi.NewRouter()
	for _, path := range []string{"/skills", "/skills/{id}/package"} {
		router.Get(path, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusAccepted) })
	}
	NewService(nil, nil).RegisterAgent(router)
	for _, path := range []string{"/skills", "/skills/owned/package"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusAccepted {
			t.Fatalf("已有目录或下载路由被覆盖: %s，状态 %d", path, w.Code)
		}
	}
}

func TestAgentUploadValidation(t *testing.T) {
	valid := archive(map[string]string{"SKILL.md": manifest})
	for _, tc := range []struct {
		name     string
		data     []byte
		metadata string
	}{
		{name: "missing"},
		{name: "invalid_zip", data: []byte("invalid")},
		{name: "invalid_metadata", data: valid, metadata: "{"},
		{name: "null_metadata", data: valid, metadata: "null"},
		{name: "array_metadata", data: valid, metadata: "[]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for method, path := range map[string]string{http.MethodPost: "/skills", http.MethodPut: "/skills/owned/package"} {
				var body bytes.Buffer
				form := multipart.NewWriter(&body)
				if tc.data != nil {
					file, err := form.CreateFormFile("package", "review.zip")
					if err != nil {
						t.Fatal(err)
					}
					if _, err := file.Write(tc.data); err != nil {
						t.Fatal(err)
					}
				}
				if err := form.WriteField("metadata", tc.metadata); err != nil {
					t.Fatal(err)
				}
				if err := form.Close(); err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(method, path, &body)
				req.Header.Set("Content-Type", form.FormDataContentType())
				w := httptest.NewRecorder()
				router := chi.NewRouter()
				NewService(nil, nil).RegisterAgent(router)
				router.ServeHTTP(w, req)
				if w.Code != http.StatusBadRequest {
					t.Fatalf("%s 未拒绝无效上传: %d %s", method, w.Code, w.Body.String())
				}
			}
		})
	}
}
