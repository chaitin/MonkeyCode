package proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProxyNegotiatesEncoding(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values []string
		want   string
		reject bool
	}{
		{name: "未声明时保留自动gzip", want: "gzip"},
		{name: "空值只接受明文", values: []string{""}, want: "identity"},
		{name: "仅gzip", values: []string{"gzip"}, want: "gzip"},
		{name: "过滤其他压缩格式", values: []string{"br, gzip, deflate, zstd"}, want: "gzip"},
		{name: "不支持的编码回退明文", values: []string{"br, zstd"}, want: "identity"},
		{name: "仅明文", values: []string{"identity"}, want: "identity"},
		{name: "禁用gzip", values: []string{"gzip;q=0, br"}, want: "identity"},
		{name: "显式偏好明文", values: []string{"gzip;q=0.5, identity;q=0.8"}, want: "identity"},
		{name: "显式偏好gzip", values: []string{"gzip;q=0.8, identity;q=0.5"}, want: "gzip"},
		{name: "同权重优先gzip", values: []string{"gzip;q=0.5, identity;q=0.5"}, want: "gzip"},
		{name: "隐式明文作为回退", values: []string{"gzip;q=0.5"}, want: "gzip"},
		{name: "禁止明文", values: []string{"gzip, identity;q=0"}, want: "gzip, identity;q=0"},
		{name: "通配符允许gzip", values: []string{"*;q=0.5"}, want: "gzip"},
		{name: "显式gzip覆盖通配禁用", values: []string{"gzip, *;q=0"}, want: "gzip, identity;q=0"},
		{name: "显式明文覆盖通配禁用", values: []string{"identity, *;q=0"}, want: "identity"},
		{name: "显式禁用gzip覆盖通配允许", values: []string{"gzip;q=0, *;q=1"}, want: "identity"},
		{name: "显式明文偏好高于通配gzip", values: []string{"identity;q=0.8, *;q=0.5"}, want: "identity"},
		{name: "多个请求头", values: []string{"br, zstd", "gzip;q=0.5, identity;q=0"}, want: "gzip, identity;q=0"},
		{name: "兼容大小写和空白", values: []string{" GZIP ; Q = 0.5 , IDENTITY ; q=0 "}, want: "gzip, identity;q=0"},
		{name: "重复gzip保留禁用", values: []string{"gzip", "gzip;q=0"}, want: "identity"},
		{name: "无效权重回退明文", values: []string{"gzip;q=invalid"}, want: "identity"},
		{name: "超出范围的权重回退明文", values: []string{"gzip;q=2"}, want: "identity"},
		{name: "NaN权重回退明文", values: []string{"gzip;q=NaN"}, want: "identity"},
		{name: "全部禁用", values: []string{"gzip;q=0, identity;q=0"}, reject: true},
		{name: "通配禁用", values: []string{"*;q=0"}, reject: true},
		{name: "只允许不支持的编码", values: []string{"br, zstd, identity;q=0"}, reject: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := make(chan string, 1)
			const body = `{"id":"encoding-call","usage":{"input_tokens":33,"output_tokens":51}}`
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls <- strings.Join(r.Header.Values("Accept-Encoding"), ", ")
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, body)
			}))
			defer upstream.Close()
			resolved := false
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				resolved = true
				return testTarget(upstream.URL + "/v1"), nil
			}), discardLogger())
			if tc.reject {
				p.WithBilling(billingMustNotRun{})
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"resource-id"}`))
			req.Header.Set("Authorization", "Bearer token")
			for _, value := range tc.values {
				req.Header.Add("Accept-Encoding", value)
			}
			w := httptest.NewRecorder()
			p.ServeHTTP(w, req)
			if tc.reject {
				if w.Code != http.StatusNotAcceptable || resolved {
					t.Fatalf("无可用编码应在模型解析和计费前拒绝: status=%d resolved=%t", w.Code, resolved)
				}
				select {
				case encoding := <-calls:
					t.Fatalf("拒绝的请求不应访问上游: %q", encoding)
				default:
				}
				return
			}
			if w.Code != http.StatusOK || w.Body.String() != body {
				t.Fatalf("编码协商不应影响正常请求: status=%d body=%q", w.Code, w.Body.String())
			}
			select {
			case encoding := <-calls:
				if encoding != tc.want {
					t.Fatalf("上游编码协商错误: got=%q want=%q", encoding, tc.want)
				}
			default:
				t.Fatal("未向上游发起请求")
			}
		})
	}
}
