package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
)

type createWriter struct {
	member.UserWriter
	input member.CreateUser
	err   error
}

func (w *createWriter) CreateUser(_ context.Context, input member.CreateUser) (member.User, error) {
	w.input = input
	return member.User{ID: "created", Name: input.Name, Email: input.Email, Role: input.Role, Status: "active"}, w.err
}

func TestCreateUserUsesInjectedWriter(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{name: "正常创建", want: http.StatusCreated},
		{name: "席位已满", err: member.ErrSeatsExceeded, want: http.StatusConflict},
		{name: "授权不可用", err: member.ErrSeatsUnavailable, want: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := &createWriter{err: tc.err}
			service := NewService(nil, nil, "").WithUserWriter(writer)
			req := httptest.NewRequest(http.MethodPost, "/users", strings.NewReader(`{"name":"测试成员","email":"test@example.com","role":"user"}`))
			recorder := httptest.NewRecorder()
			service.createUser(recorder, req)
			if recorder.Code != tc.want {
				t.Fatalf("状态码=%d，期望=%d，响应=%s", recorder.Code, tc.want, recorder.Body.String())
			}
			if writer.input.Email != "test@example.com" || writer.input.Name != "测试成员" {
				t.Fatalf("未将创建请求传给 Pro 写入接口: %+v", writer.input)
			}
		})
	}
}
