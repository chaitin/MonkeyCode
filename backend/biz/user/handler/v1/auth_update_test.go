package v1

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestUpdateUserRoute(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	w := web.New()
	h := &AuthHandler{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		usecase: &updateUserUsecaseStub{userID: userID},
	}
	g := w.Group("/api/v1/users")
	g.PUT("", web.BindHandler(h.Update), setUserMiddleware(&domain.User{ID: userID}))

	body := &strings.Builder{}
	mw := multipart.NewWriter(body)
	if err := mw.WriteField("name", "新昵称"); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("avatar_url", "https://example.com/avatar.png"); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users", strings.NewReader(body.String()))
	req.Header.Set(echo.HeaderContentType, mw.FormDataContentType())
	rec := httptest.NewRecorder()

	w.Echo().ServeHTTP(rec, req)

	if rec.Code == http.StatusNotFound {
		t.Fatal("PUT /api/v1/users route is not registered")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Code int                   `json:"code"`
		Data domain.UpdateUserResp `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Code != 0 {
		t.Fatalf("code = %d", resp.Code)
	}
	if resp.Data.User == nil || resp.Data.User.Name != "新昵称" || resp.Data.User.AvatarURL != "https://example.com/avatar.png" {
		t.Fatalf("data = %#v", resp.Data)
	}
}

func setUserMiddleware(user *domain.User) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			middleware.SetUser(c, user)
			return next(c)
		}
	}
}

type updateUserUsecaseStub struct {
	domain.UserUsecase
	userID uuid.UUID
}

func (s *updateUserUsecaseStub) Update(ctx context.Context, uid uuid.UUID, avatarURL string, req domain.UpdateUserReq) (*domain.User, error) {
	return &domain.User{
		ID:        uid,
		Name:      req.Name,
		AvatarURL: avatarURL,
	}, nil
}

func (s *updateUserUsecaseStub) Get(ctx context.Context, uid uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: uid}, nil
}

func (s *updateUserUsecaseStub) GetUserWithTeams(ctx context.Context, userID uuid.UUID) (*domain.TeamUserInfo, error) {
	return &domain.TeamUserInfo{}, nil
}

func (s *updateUserUsecaseStub) PasswordLogin(ctx context.Context, req *domain.TeamLoginReq) (*domain.User, error) {
	return nil, nil
}

func (s *updateUserUsecaseStub) ChangePassword(ctx context.Context, userID uuid.UUID, req *domain.ChangePasswordReq, isReset bool) error {
	return nil
}

func (s *updateUserUsecaseStub) SendResetPasswordEmail(ctx context.Context, req *domain.ResetUserPasswordEmailReq) error {
	return nil
}

func (s *updateUserUsecaseStub) GetUserByEmail(ctx context.Context, emails []string) ([]*domain.User, error) {
	return nil, nil
}

func (s *updateUserUsecaseStub) SendBindEmailVerification(ctx context.Context, userID uuid.UUID, req *domain.SendBindEmailVerificationReq) error {
	return nil
}

func (s *updateUserUsecaseStub) VerifyBindEmail(ctx context.Context, token string) error {
	return nil
}
