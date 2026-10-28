package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestDiscoverModelsProtocols(t *testing.T) {
	for _, protocol := range []Protocol{ProtocolOpenAIChat, ProtocolOpenAIResponses, ProtocolAnthropic} {
		t.Run(string(protocol), func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "GET" || r.URL.Path != "/custom/v1/models" || r.URL.Query().Get("source") != "test" || strings.Contains(r.URL.String(), "secret") {
					t.Errorf("错误的上游请求: %s %s", r.Method, r.URL)
				}
				if protocol == ProtocolAnthropic {
					if r.Header.Get("X-Api-Key") != "secret" || r.Header.Get("Anthropic-Version") != "2023-06-01" || r.Header.Get("Authorization") != "" {
						t.Error("Anthropic 鉴权错误")
					}
					if r.URL.Query().Get("after_id") == "" {
						fmt.Fprint(w, `{"data":[{"id":"z"}],"has_more":true,"last_id":"cursor-z"}`)
						return
					}
					if r.URL.Query().Get("after_id") != "cursor-z" {
						t.Error("分页游标错误")
					}
				} else if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Api-Key") != "" {
					t.Error("OpenAI 鉴权错误")
				}
				fmt.Fprint(w, `{"data":[{"id":"z"},{"id":" a "},{"id":"a"},{"id":""}]}`)
			}))
			defer upstream.Close()
			models, err := NewService(&repositoryStub{}).DiscoverModels(t.Context(), DiscoverInput{BaseURL: upstream.URL + "/custom/v1/?source=test", Protocol: protocol, APIKey: "secret"})
			if err != nil || !reflect.DeepEqual(models, []DiscoveredModel{{ID: "a"}, {ID: "z"}}) {
				t.Fatalf("models=%+v err=%v", models, err)
			}
			wantCalls := int32(1)
			if protocol == ProtocolAnthropic {
				wantCalls = 2
			}
			if calls.Load() != wantCalls {
				t.Fatalf("请求次数=%d", calls.Load())
			}
		})
	}
}

func TestDiscoverySavedKeyAndOverride(t *testing.T) {
	var wanted atomic.Value
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+wanted.Load().(string) {
			t.Error("没有使用正确密钥")
		}
		fmt.Fprint(w, `{"data":[]}`)
	}))
	defer upstream.Close()
	repo := &repositoryStub{models: []Model{{ID: "stored", Kind: KindText, OwnershipType: "system", APIKey: "saved-secret"}, {ID: "personal", Kind: KindText, OwnershipType: "user", APIKey: "private-secret"}}}
	svc := NewService(repo)
	for _, key := range []string{"", "override-secret"} {
		expectedKey := key
		if expectedKey == "" {
			expectedKey = "saved-secret"
		}
		wanted.Store(expectedKey)
		models, err := svc.DiscoverModels(t.Context(), DiscoverInput{BaseURL: upstream.URL, Protocol: ProtocolOpenAIResponses, APIKey: key, ModelResourceID: "stored"})
		if err != nil || models == nil || len(models) != 0 {
			t.Fatalf("空目录应返回非 nil 列表: %+v %v", models, err)
		}
	}
	for _, id := range []string{"personal", "missing"} {
		if _, err := svc.DiscoverModels(t.Context(), DiscoverInput{BaseURL: upstream.URL, Protocol: ProtocolAnthropic, ModelResourceID: id}); err == nil {
			t.Fatal("不能读取非系统模型的凭据")
		}
	}
}

func TestDiscoveryRejectsInvalidConnection(t *testing.T) {
	for _, input := range []DiscoverInput{
		{BaseURL: "file:///etc/passwd", Protocol: ProtocolOpenAIChat, APIKey: "secret"},
		{BaseURL: "http://user:password@example.com", Protocol: ProtocolOpenAIChat, APIKey: "secret"},
		{BaseURL: "http://example.com/#fragment", Protocol: ProtocolOpenAIChat, APIKey: "secret"},
		{BaseURL: "http://example.com", Protocol: ProtocolImage, APIKey: "secret"},
		{BaseURL: "http://example.com", Protocol: ProtocolOpenAIChat},
		{BaseURL: "http://example.com", Protocol: ProtocolOpenAIChat, APIKey: "secret\r\ninjected: value"},
	} {
		if _, err := NewService(&repositoryStub{}).DiscoverModels(t.Context(), input); err == nil {
			t.Fatal("无效连接参数不能通过")
		}
	}
}

func TestDiscoveryDoesNotFollowRedirectsOrExposeUpstreamSecrets(t *testing.T) {
	var destinationCalls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { destinationCalls.Add(1) }))
	defer destination.Close()
	for _, status := range []int{http.StatusFound, http.StatusUnauthorized, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", destination.URL)
				w.WriteHeader(status)
				fmt.Fprint(w, "upstream echoed secret-key")
			}))
			defer upstream.Close()
			router := chi.NewRouter()
			NewService(&repositoryStub{}).RegisterAdmin(router)
			body, _ := json.Marshal(DiscoverInput{BaseURL: upstream.URL, Protocol: ProtocolOpenAIChat, APIKey: "secret-key"})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest("POST", "/models/discover", strings.NewReader(string(body))))
			if recorder.Code != http.StatusBadGateway || strings.Contains(recorder.Body.String(), "secret-key") || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("错误响应: %d %s", recorder.Code, recorder.Body.String())
			}
		})
	}
	if destinationCalls.Load() != 0 {
		t.Fatal("不能把密钥发送至重定向目标")
	}
}

func TestDiscoveryBoundsAndInvalidResponses(t *testing.T) {
	for _, body := range []string{`{"models":[]}`, `{"data":null}`, `{"data":[{"id":42}]}`, `{"data":[],"has_more":true}`, `{"data":[],"has_more":true,"last_id":"same"}`, strings.Repeat("x", (2<<20)+1)} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		_, err := NewService(&repositoryStub{}).DiscoverModels(t.Context(), DiscoverInput{BaseURL: upstream.URL, Protocol: ProtocolOpenAIChat, APIKey: "secret"})
		upstream.Close()
		if !errors.Is(err, errDiscoveryUpstream) {
			t.Fatalf("错误响应必须失败: %v", err)
		}
	}
}

type discoveryProxy struct{ url string }

func (p discoveryProxy) ProxyURL(context.Context, string) (string, error) { return p.url, nil }

func TestDiscoveryUsesProxy(t *testing.T) {
	var calls atomic.Int32
	upstreamProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.String() != "http://upstream.invalid/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("没有使用配置的代理")
		}
		fmt.Fprint(w, `{"data":[{"id":"proxied-model"}]}`)
	}))
	defer upstreamProxy.Close()
	svc := NewService(&repositoryStub{}).WithProxyResolver(discoveryProxy{url: upstreamProxy.URL})
	models, err := svc.DiscoverModels(t.Context(), DiscoverInput{BaseURL: "http://upstream.invalid/v1", Protocol: ProtocolOpenAIChat, APIKey: "secret", ProxyID: "proxy"})
	if err != nil || len(models) != 1 || models[0].ID != "proxied-model" || calls.Load() != 1 {
		t.Fatalf("代理查询错误: %+v %v", models, err)
	}
}

func TestDiscoveryCancellation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Millisecond)
	defer cancel()
	_, err := NewService(&repositoryStub{}).DiscoverModels(ctx, DiscoverInput{BaseURL: upstream.URL, Protocol: ProtocolOpenAIChat, APIKey: "secret"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("请求应被取消: %v", err)
	}
}
