package setting

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func brandingFormRequest(t *testing.T, workspace, product, action string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for key, value := range map[string]string{"workspace_name": workspace, "product_name": product, "logo_action": action} {
		if err := form.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if data != nil {
		file, err := form.CreateFormFile("logo", "logo.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("PUT", "/settings/branding", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	return request
}

func TestBrandingFormAtomicSaveAndRetry(t *testing.T) {
	store := &logoStore{memoryStore: memoryStore{records: map[string]Record{"branding": {Key: "branding", Value: json.RawMessage(`{"workspace_name":"Old team","product_name":"Old product","logo_s3_key":"branding/logos/original.png"}`)}}}}
	storage := &logoStorage{files: map[string][]byte{}}
	service := NewService(store).WithLogoStorage(storage, "https://example.test")
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 12, 16))); err != nil {
		t.Fatal(err)
	}
	original := string(store.records["branding"].Value)
	save := func(workspace, product, action string, data []byte) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, brandingFormRequest(t, workspace, product, action, data))
		return response
	}
	for _, response := range []*httptest.ResponseRecorder{save("", "Product", "replace", imageData.Bytes()), save("Team", "Product", "invalid", nil), save("Team", "Product", "replace", []byte("broken image"))} {
		if response.Code != 400 {
			t.Fatalf("invalid form=%d %s", response.Code, response.Body.String())
		}
	}
	if len(storage.files) != 0 || string(store.records["branding"].Value) != original {
		t.Fatal("invalid form changed branding")
	}
	store.fail = true
	response := save("New team", "New product", "replace", imageData.Bytes())
	if response.Code != 500 || len(storage.files) != 0 || string(store.records["branding"].Value) != original {
		t.Fatal("failed save changed names/logo or leaked upload")
	}
	store.fail = false
	response = save("New team", "New product", "replace", imageData.Bytes())
	if response.Code != 200 || strings.Contains(response.Body.String(), "logo_s3_key") || !strings.Contains(response.Body.String(), "logo_url") {
		t.Fatalf("save=%d %s", response.Code, response.Body.String())
	}
	var value map[string]string
	if err := json.Unmarshal(store.records["branding"].Value, &value); err != nil {
		t.Fatal(err)
	}
	if value["workspace_name"] != "New team" || value["product_name"] != "New product" || !strings.HasPrefix(value["logo_s3_key"], "branding/logos/") {
		t.Fatalf("incomplete save=%v", value)
	}
	original = string(store.records["branding"].Value)
	store.fail = true
	response = save("Reset team", "Reset product", "reset", nil)
	if response.Code != 500 || string(store.records["branding"].Value) != original {
		t.Fatal("failed reset changed branding")
	}
	store.fail = false
	response = save("Reset team", "Reset product", "reset", nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"logo_url":""`) {
		t.Fatalf("reset=%d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(store.records["branding"].Value, &value); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(store.records["branding"].Value), "logo_s3_key") || value["workspace_name"] != "Reset team" {
		t.Fatal("reset did not save names and clear logo together")
	}
}
