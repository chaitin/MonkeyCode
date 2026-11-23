package model

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAnthropicProbeAndDiscoveryPaths(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gateway/v1/models" || r.URL.Query().Get("source") != "test" {
			t.Errorf("错误的模型发现地址：%s", r.URL)
		}
		_, _ = io.WriteString(w, `{"data":[{"id":"test-model"}]}`)
	}))
	defer upstream.Close()

	for _, prefix := range []string{"/gateway", "/gateway/v1/"} {
		t.Run(prefix, func(t *testing.T) {
			baseURL := upstream.URL + prefix + "?source=test"
			probe, err := probeRequest(Model{BaseURL: baseURL, Protocol: ProtocolAnthropic, ModelID: "test-model", APIKey: "test-key"}, "hello")
			if want := upstream.URL + "/gateway/v1/messages?source=test"; err != nil || probe.URL != want {
				t.Fatalf("探测地址 = %q，期望 %q，错误 = %v", probe.URL, want, err)
			}
			models, err := NewService(&repositoryStub{}).DiscoverModels(t.Context(), DiscoverInput{BaseURL: baseURL, Protocol: ProtocolAnthropic, APIKey: "test-key"})
			if err != nil || len(models) != 1 || models[0].ID != "test-model" {
				t.Fatalf("模型发现结果 = %v，错误 = %v", models, err)
			}
		})
	}
}
