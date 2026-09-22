package imageproxy

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type generatorFunc func(context.Context, proxy.Target, GenerateRequest) (Task, error)

func (f generatorFunc) Generate(ctx context.Context, t proxy.Target, r GenerateRequest) (Task, error) {
	return f(ctx, t, r)
}

type editorFunc func(context.Context, proxy.Target, EditRequest) (Task, error)

func (f editorFunc) Edit(ctx context.Context, t proxy.Target, r EditRequest) (Task, error) {
	return f(ctx, t, r)
}

type taskFunc func(context.Context, string, string) (Task, error)

func (f taskFunc) Get(ctx context.Context, userID, taskID string) (Task, error) {
	return f(ctx, userID, taskID)
}

type keyFunc func(context.Context, string, string) (string, error)

func (f keyFunc) Authenticate(ctx context.Context, key, scope string) (string, error) {
	return f(ctx, key, scope)
}

func router(p *Proxy) http.Handler {
	r := chi.NewRouter()
	p.Register(r)
	return r
}

func request(handler http.Handler, method, path, body, bearer string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

type uploadFunc func(context.Context, string, []byte) (InputFile, error)

func (f uploadFunc) Upload(ctx context.Context, userID string, content []byte) (InputFile, error) {
	return f(ctx, userID, content)
}

func TestInputUploadAuthenticatesAndLimitsParts(t *testing.T) {
	called := 0
	p := NewProxy(nil, keyFunc(func(_ context.Context, credential, scope string) (string, error) {
		if credential != "invoke-key" || scope != "model:invoke" {
			return "", errors.New("no access")
		}
		return "owner", nil
	}), nil, nil, nil).WithInputs(uploadFunc(func(_ context.Context, owner string, data []byte) (InputFile, error) {
		if owner != "owner" || string(data) != "image-data" {
			t.Fatalf("上传身份或数据无效: %s %s", owner, data)
		}
		called++
		return InputFile{FileID: "file-1"}, nil
	}))
	multipartRequest := func(extra bool, credential string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "image.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte("image-data")); err != nil {
			t.Fatal(err)
		}
		if extra {
			part, err = writer.CreateFormFile("file", "other.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write([]byte("more")); err != nil {
				t.Fatal(err)
			}
		}
		writer.Close()
		r := httptest.NewRequest(http.MethodPost, "/v1/images/inputs", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		if credential != "" {
			r.Header.Set("X-Api-Key", credential)
		}
		response := httptest.NewRecorder()
		router(p).ServeHTTP(response, r)
		return response
	}
	if res := multipartRequest(false, "invoke-key"); res.Code != http.StatusCreated || !strings.Contains(res.Body.String(), "file-1") {
		t.Fatalf("上传失败: %d %s", res.Code, res.Body.String())
	}
	if res := multipartRequest(true, "invoke-key"); res.Code != http.StatusBadRequest {
		t.Fatalf("多文件上传未拒绝: %d", res.Code)
	}
	if res := multipartRequest(false, "revoked"); res.Code != http.StatusUnauthorized {
		t.Fatalf("无效密钥未拒绝: %d", res.Code)
	}
	if called != 1 {
		t.Fatalf("后端调用次数: %d", called)
	}
}

type outputFunc func(context.Context, string, string) ([]byte, string, error)

func (f outputFunc) Open(ctx context.Context, userID, id string) ([]byte, string, error) {
	return f(ctx, userID, id)
}

func TestImageOutputRequiresSameKeyAndOwner(t *testing.T) {
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	p := NewProxy(nil, keyFunc(func(_ context.Context, key, scope string) (string, error) {
		if key != "invoke-key" || scope != "model:invoke" {
			return "", errors.New("invalid key")
		}
		return "owner", nil
	}), nil, nil, nil).WithOutputs(outputFunc(func(_ context.Context, userID, id string) ([]byte, string, error) {
		if userID != "owner" || id != "output-1" {
			return nil, "", resource.NotFound
		}
		return data.Bytes(), "image/png", nil
	}))
	h := router(p)
	w := request(h, http.MethodGet, "/v1/images/outputs/output-1", "", "invoke-key")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Content-Type-Options") != "nosniff" || !bytes.Equal(w.Body.Bytes(), data.Bytes()) {
		t.Fatalf("图片输出失败: %d, %s", w.Code, w.Body.String())
	}
	for _, tc := range []struct {
		path, key string
		status    int
	}{
		{"/v1/images/outputs/output-1", "revoked", http.StatusUnauthorized},
		{"/v1/images/outputs/other", "invoke-key", http.StatusNotFound},
	} {
		w := request(h, http.MethodGet, tc.path, "", tc.key)
		if w.Code != tc.status {
			t.Fatalf("图片访问未隔离: %s %d", tc.path, w.Code)
		}
	}
}

func TestGenerateAndEditResolveAuthorizedImageModel(t *testing.T) {
	var operations []string
	resolver := proxy.ResolverFunc(func(_ context.Context, credential, requestedModel string) (proxy.Target, error) {
		if credential != "invoke-key" || requestedModel != "image@id" {
			return proxy.Target{}, errors.New("forbidden")
		}
		return proxy.Target{ModelID: "id", UserID: "user-1", Protocol: imageProtocol}, nil
	})
	p := NewProxy(resolver, nil,
		generatorFunc(func(_ context.Context, target proxy.Target, req GenerateRequest) (Task, error) {
			if target.UserID != "user-1" || req.Prompt != "画一只猫" || req.Quality != "2K" || req.AspectRatio != "1:1" || req.Count == nil || *req.Count != 2 || len(req.ReferenceImages) != 0 {
				t.Fatalf("生成请求无效: %#v, %#v", target, req)
			}
			operations = append(operations, "generate")
			return Task{ID: "task-1", Operation: "generate", Status: "pending"}, nil
		}),
		editorFunc(func(_ context.Context, target proxy.Target, req EditRequest) (Task, error) {
			if target.UserID != "user-1" || len(req.Images) != 1 || req.Images[0].FileID != "file-1" || req.Mask == nil || req.Mask.FileID != "mask-1" {
				t.Fatalf("编辑请求无效: %#v, %#v", target, req)
			}
			operations = append(operations, "edit")
			return Task{ID: "task-2", Operation: "edit", Status: "running"}, nil
		}), nil)
	h := router(p)
	for _, test := range []struct{ path, body, id string }{
		{"/v1/images/generations", `{"model":"image@id","prompt":"画一只猫","quality":"2K","aspect_ratio":"1:1","count":2}`, "task-1"},
		{"/v1/images/edits", `{"model":"image@id","prompt":"更换背景","images":[{"file_id":"file-1"}],"mask":{"file_id":"mask-1"}}`, "task-2"},
	} {
		w := request(h, http.MethodPost, test.path, test.body, "invoke-key")
		if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"id":"`+test.id+`"`) {
			t.Fatalf("%s: status=%d body=%s", test.path, w.Code, w.Body.String())
		}
	}
	if len(operations) != 2 || operations[0] != "generate" || operations[1] != "edit" {
		t.Fatalf("业务路由 = %v", operations)
	}
}

func TestTaskQueryUsesModelInvocationScopeAndUser(t *testing.T) {
	p := NewProxy(nil,
		keyFunc(func(_ context.Context, credential, scope string) (string, error) {
			if scope != "model:invoke" || credential != "invoke-key" {
				return "", errors.New("invalid key")
			}
			return "user-1", nil
		}), nil, nil,
		taskFunc(func(_ context.Context, userID, taskID string) (Task, error) {
			if userID != "user-1" || taskID != "task-1" {
				return Task{}, resource.NotFound
			}
			return Task{UserID: userID, ID: taskID, Operation: "generate", Status: "succeeded"}, nil
		}))
	h := router(p)
	w := request(h, http.MethodGet, "/v1/images/tasks/task-1", "", "invoke-key")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"succeeded"`) {
		t.Fatalf("任务查询: status=%d body=%s", w.Code, w.Body.String())
	}
	for _, tc := range []struct {
		path, key string
		status    int
	}{
		{"/v1/images/tasks/task-1", "other-key", http.StatusUnauthorized},
		{"/v1/images/tasks/other-task", "invoke-key", http.StatusNotFound},
	} {
		w := request(h, http.MethodGet, tc.path, "", tc.key)
		if w.Code != tc.status {
			t.Fatalf("%s: status=%d want=%d", tc.path, w.Code, tc.status)
		}
	}
}

func TestTaskQueryRejectsMismatchedOwner(t *testing.T) {
	p := NewProxy(nil, keyFunc(func(context.Context, string, string) (string, error) {
		return "user-1", nil
	}), nil, nil, taskFunc(func(context.Context, string, string) (Task, error) {
		return Task{UserID: "user-2", ID: "task-1", Status: "succeeded"}, nil
	}))
	w := request(router(p), http.MethodGet, "/v1/images/tasks/task-1", "", "invoke-key")
	if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "user-2") {
		t.Fatalf("跨用户任务查询: status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProxyReusesLLMCredentialPrecedence(t *testing.T) {
	p := NewProxy(proxy.ResolverFunc(func(_ context.Context, credential, _ string) (proxy.Target, error) {
		if credential != "header-key" {
			return proxy.Target{}, errors.New("invalid credential")
		}
		return proxy.Target{UserID: "user-1", Protocol: imageProtocol}, nil
	}), nil, generatorFunc(func(context.Context, proxy.Target, GenerateRequest) (Task, error) {
		return Task{ID: "task-1"}, nil
	}), nil, nil)
	r := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(`{"model":"image@id","prompt":"hi"}`))
	r.Header.Set("X-Api-Key", "header-key")
	r.Header.Set("Authorization", "Bearer wrong-key")
	w := httptest.NewRecorder()
	router(p).ServeHTTP(w, r)
	if w.Code != http.StatusAccepted {
		t.Fatalf("X-Api-Key 优先级错误: %d %s", w.Code, w.Body.String())
	}
}

func TestProxyRejectsInvalidOrUnauthorizedRequests(t *testing.T) {
	called := false
	p := NewProxy(proxy.ResolverFunc(func(context.Context, string, string) (proxy.Target, error) {
		return proxy.Target{UserID: "user-1", Protocol: "openai_responses"}, nil
	}), keyFunc(func(context.Context, string, string) (string, error) {
		return "", errors.New("revoked")
	}), generatorFunc(func(context.Context, proxy.Target, GenerateRequest) (Task, error) {
		called = true
		return Task{ID: "task"}, nil
	}), nil, nil)
	h := router(p)
	for _, tc := range []struct {
		path, body, key string
		want            int
	}{
		{"/v1/images/generations", `{"model":"image@id","prompt":"hi"}`, "", http.StatusUnauthorized},
		{"/v1/images/generations", `{"model":"image@id","prompt":"hi","operation":"edit"}`, "invoke-key", http.StatusBadRequest},
		{"/v1/images/generations", `{"model":"image@id","prompt":"hi","count":0}`, "invoke-key", http.StatusBadRequest},
		{"/v1/images/generations", `{"model":"image@id","prompt":"hi"}`, "invoke-key", http.StatusBadRequest},
		{"/v1/images/edits", `{"model":"image@id","prompt":"hi","images":[]}`, "invoke-key", http.StatusBadRequest},
		{"/v1/images/tasks/task", "", "invoke-key", http.StatusServiceUnavailable},
	} {
		method := http.MethodPost
		if strings.Contains(tc.path, "/tasks/") {
			method = http.MethodGet
		}
		w := request(h, method, tc.path, tc.body, tc.key)
		if w.Code != tc.want {
			t.Errorf("%s (%s): status=%d want=%d body=%s", tc.path, tc.body, w.Code, tc.want, w.Body.String())
		}
	}
	if called {
		t.Fatal("非法请求触发了生图后端")
	}
}

func TestRequestSizeLimit(t *testing.T) {
	p := NewProxy(nil, nil, nil, nil, nil)
	body := `{"model":"image@id","prompt":"` + strings.Repeat("x", 1<<20) + `"}`
	w := request(router(p), http.MethodPost, "/v1/images/generations", body, "invoke-key")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("超过请求大小上限: %d", w.Code)
	}
}

func TestUnauthenticatedTaskDoesNotCallStore(t *testing.T) {
	p := NewProxy(nil, keyFunc(func(context.Context, string, string) (string, error) {
		return "", errors.New("revoked")
	}), nil, nil, taskFunc(func(context.Context, string, string) (Task, error) {
		t.Fatal("未授权请求不应查询任务")
		return Task{}, nil
	}))
	w := request(router(p), http.MethodGet, "/v1/images/tasks/task-1", "", "revoked-key")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("失效密钥应返回 401: %d", w.Code)
	}
}
