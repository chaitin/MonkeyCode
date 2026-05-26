package oauth

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
	"github.com/google/uuid"
)

type Wechat struct {
	config *config.Config
	client *request.Client
}

func NewWechat(config *config.Config) domain.OAuther {
	client := request.NewClient("https", "api.weixin.qq.com", 15*time.Second)
	client.SetDebug(config.Wechat.Open.Debug)
	return &Wechat{config: config, client: client}
}

// GetAuthorizeInfo implements domain.OAuther.
func (w *Wechat) GetAuthorizeInfo() (*domain.OAuthInfo, error) {
	return &domain.OAuthInfo{
		State:       uuid.NewString(),
		RedirectURI: w.config.Wechat.Open.CallbackURL,
		Scope:       w.config.Wechat.Open.Scope,
		AppID:       w.config.Wechat.Open.AppID,
	}, nil
}

// GetAuthorizeURL implements domain.OAuther.
func (w *Wechat) GetAuthorizeURL() (state string, u string) {
	s := uuid.NewString()
	c := url.QueryEscape(w.config.Wechat.Open.CallbackURL)
	return s, fmt.Sprintf("https://open.weixin.qq.com/connect/qrconnect?appid=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s", w.config.Wechat.Open.AppID, c, w.config.Wechat.Open.Scope, s)
}

// GetUserInfo implements domain.OAuther.
func (w *Wechat) GetUserInfo(code string) (*domain.OAuthUserInfo, error) {
	accessToken, err := w.getAccessToken(code)
	if err != nil {
		return nil, err
	}
	info, err := w.getUserInfo(accessToken.AccessToken, accessToken.OpenID)
	if err != nil {
		return nil, err
	}
	return &domain.OAuthUserInfo{
		ID:        info.OpenID,
		UnionID:   info.UnionID,
		Name:      info.Nickname,
		Email:     "",
		AvatarURL: info.HeadImgURL,
	}, nil
}

type wechatAccessToken struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	OpenID       string `json:"openid"`
	Scope        string `json:"scope"`
	UnionID      string `json:"unionid"`
}

func (w *Wechat) getAccessToken(code string) (*wechatAccessToken, error) {
	return request.Get[wechatAccessToken](w.client, context.Background(), "/sns/oauth2/access_token", request.WithQuery(
		request.Query{
			"appid":      w.config.Wechat.Open.AppID,
			"secret":     w.config.Wechat.Open.AppSecret,
			"code":       code,
			"grant_type": "authorization_code",
		},
	))
}

type wechatUserInfo struct {
	OpenID     string   `json:"openid"`
	Nickname   string   `json:"nickname"`
	Sex        int      `json:"sex"`
	Province   string   `json:"province"`
	City       string   `json:"city"`
	Country    string   `json:"country"`
	HeadImgURL string   `json:"headimgurl"`
	Privilege  []string `json:"privilege"`
	UnionID    string   `json:"unionid"`
}

func (w *Wechat) getUserInfo(accessToken, openID string) (*wechatUserInfo, error) {
	return request.Get[wechatUserInfo](w.client, context.Background(), "/sns/userinfo", request.WithQuery(
		request.Query{
			"access_token": accessToken,
			"openid":       openID,
		},
	))
}
