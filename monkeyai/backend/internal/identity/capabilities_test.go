package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/license"
)

type capabilitySource struct {
	value license.Capabilities
	err   error
}

func (s *capabilitySource) Capabilities(context.Context) (license.Capabilities, error) {
	return s.value, s.err
}
func (s authenticationStub) PublicValue(ctx context.Context) (json.RawMessage, error) {
	return s.GetValue(ctx, "branding")
}

func TestPublicCapabilitiesUseExplicitHostSource(t *testing.T) {
	source := &capabilitySource{}
	service := NewService(nil, nil, "").WithLicense(source)
	for _, cloud := range []bool{false, true} {
		for _, branding := range []bool{false, true} {
			source.value = license.Capabilities{AllowCloudComputer: cloud, AllowCustomBranding: branding}
			response := httptest.NewRecorder()
			service.AuthRouter().ServeHTTP(response, httptest.NewRequest("GET", "/capabilities", nil))
			var got map[string]any
			if json.Unmarshal(response.Body.Bytes(), &got) != nil || len(got) != 2 || got["allow_cloud_computer"] != cloud || got["allow_custom_branding"] != branding {
				t.Fatalf("能力=%s", response.Body.String())
			}
		}
	}
	source.err = errors.New("private failure")
	response := httptest.NewRecorder()
	service.AuthRouter().ServeHTTP(response, httptest.NewRequest("GET", "/capabilities", nil))
	var got license.Capabilities
	if json.Unmarshal(response.Body.Bytes(), &got) != nil || got.AllowCloudComputer || got.AllowCustomBranding || strings.Contains(response.Body.String(), "private failure") {
		t.Fatal("授权查询失败未关闭能力")
	}
}
func TestNoCommercialModuleUsesDefaults(t *testing.T) {
	settings := authenticationStub{json.RawMessage(`{"workspace_name":"旧团队","product_name":"旧产品","logo_url":"/old.png"}`)}
	service := NewService(nil, settings, "")
	for _, path := range []string{"/branding", "/branding/logo", "/capabilities"} {
		response := httptest.NewRecorder()
		service.AuthRouter().ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if path == "/branding/logo" {
			if response.Code != 404 {
				t.Fatal("默认入口仍注册了自定义 Logo 路由")
			}
		} else if strings.Contains(response.Body.String(), "旧") || strings.Contains(response.Body.String(), "/old.png") {
			t.Fatal("未装配模块仍使用旧品牌")
		}
	}
}
