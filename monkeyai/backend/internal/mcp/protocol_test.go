package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRPCRequests(t *testing.T) {
	for _, test := range []struct {
		name, body, id, params string
		code, status           int
	}{
		{name: "字符串 ID", body: `{"jsonrpc":"2.0","id":"call-1","method":"ping"}`, id: `"call-1"`},
		{name: "大整数 ID", body: `{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}`, id: `9007199254740993`},
		{name: "通知", body: `{"jsonrpc":"2.0","method":"notifications/initialized"}`},
		{name: "无参工具目录", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`, id: `2`},
		{name: "null 工具目录参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":null}`, id: `2`},
		{name: "空对象工具目录参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`, id: `2`, params: `{}`},
		{name: "工具目录游标", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"cursor":"next"}}`, id: `2`, params: `{"cursor":"next"}`},
		{name: "null 心跳参数", body: `{"jsonrpc":"2.0","id":2,"method":"ping","params": null }`, id: `2`},
		{name: "null 通知参数", body: `{"jsonrpc":"2.0","method":"notifications/initialized","params":null}`},
		{name: "null 初始化参数留给方法校验", body: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":null}`, id: `1`},
		{name: "null 调用参数留给方法校验", body: `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":null}`, id: `2`},
		{name: "调用参数保真", body: `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"value":9007199254740993},"_meta":{"trace":"request"}}}`, id: `2`, params: `{"name":"search","arguments":{"value":9007199254740993},"_meta":{"trace":"request"}}`},
		{name: "解析失败", body: `{`, code: -32700, status: 400},
		{name: "连续对象", body: `{} {}`, code: -32700, status: 400},
		{name: "批量请求", body: `[{}]`, code: -32600, status: 400},
		{name: "空对象", body: `null`, code: -32600, status: 400},
		{name: "版本错误", body: `{"jsonrpc":"1.0","id":1,"method":"ping"}`, code: -32600, status: 400},
		{name: "空 ID", body: `{"jsonrpc":"2.0","id":null,"method":"ping"}`, code: -32600, status: 400},
		{name: "对象 ID", body: `{"jsonrpc":"2.0","id":{},"method":"ping"}`, code: -32600, status: 400},
		{name: "布尔 ID", body: `{"jsonrpc":"2.0","id":true,"method":"ping"}`, code: -32600, status: 400},
		{name: "数组参数", body: `{"jsonrpc":"2.0","id":"a","method":"tools/call","params":[]}`, code: -32602, status: 400},
		{name: "工具目录数组参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":[]}`, code: -32602, status: 400},
		{name: "字符串参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":"null"}`, code: -32602, status: 400},
		{name: "数字参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":0}`, code: -32602, status: 400},
		{name: "布尔参数", body: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":false}`, code: -32602, status: 400},
		{name: "超限", body: strings.Repeat(" ", (1<<20)+1), code: -32700, status: 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			in, ok := readRequest(w, httptest.NewRequest("POST", "/mcp", strings.NewReader(test.body)))
			if test.code == 0 {
				if !ok || string(in.ID) != test.id || string(in.Params) != test.params {
					t.Fatalf("请求未被保真解析: %+v %s", in, w.Body.String())
				}
				return
			}
			var out struct {
				Version string   `json:"jsonrpc"`
				Error   rpcError `json:"error"`
			}
			if ok || w.Code != test.status || json.Unmarshal(w.Body.Bytes(), &out) != nil || out.Version != "2.0" || out.Error.Code != test.code {
				t.Fatalf("错误协议不匹配: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

type gatewayKeys struct{}

func (gatewayKeys) Authenticate(_ context.Context, token, scope string) (string, error) {
	if token != "invoke-key" || scope != "mcp:invoke" {
		return "", errors.New("调用密钥无效")
	}
	return "user", nil
}

func TestGatewayTransport(t *testing.T) {
	router := chi.NewRouter()
	(&Service{PublicURL: "https://monkeyai.example"}).RegisterGateway(router, gatewayKeys{}, nil)
	for _, test := range []struct {
		name, method, token, origin, media, version string
		status                                      int
	}{
		{name: "匿名", method: "POST", status: 401},
		{name: "错误密钥", method: "POST", token: "wrong", status: 401},
		{name: "外站来源", method: "POST", token: "invoke-key", origin: "https://evil.example", status: 403},
		{name: "来源带用户信息", method: "POST", token: "invoke-key", origin: "https://name@monkeyai.example", status: 403},
		{name: "空来源", method: "POST", token: "invoke-key", origin: "null", status: 403},
		{name: "不支持订阅", method: "GET", token: "invoke-key", status: 405},
		{name: "不维护下游会话", method: "DELETE", token: "invoke-key", status: 405},
		{name: "不支持表单", method: "POST", token: "invoke-key", media: "text/plain", status: 415},
		{name: "不支持版本", method: "POST", token: "invoke-key", media: "application/json", version: "2099-01-01", status: 400},
		{name: "同站请求解析", method: "POST", token: "invoke-key", origin: "https://monkeyai.example", media: "application/json", version: protocolVersion, status: 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(test.method, "/mcp/connectors/example", strings.NewReader("{"))
			if test.token != "" {
				r.Header.Set("Authorization", "bearer "+test.token)
			}
			r.Header.Set("Origin", test.origin)
			r.Header.Set("Content-Type", test.media)
			r.Header.Set("MCP-Protocol-Version", test.version)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			if w.Code != test.status {
				t.Fatalf("状态错误: %d %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("代理响应不能缓存")
			}
			if w.Code == http.StatusMethodNotAllowed && w.Header().Get("Allow") != "POST" {
				t.Fatal("缺少允许的方法")
			}
			if w.Code == http.StatusUnauthorized && w.Header().Get("WWW-Authenticate") == "" {
				t.Fatal("缺少认证挑战")
			}
		})
	}
}
