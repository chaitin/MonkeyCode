package domain

// OAuthUserInfo 第三方平台返回的用户信息
type OAuthUserInfo struct {
	ID        string `json:"id"`
	UnionID   string `json:"union_id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

// OAuthInfo OAuth 授权所需的客户端信息
type OAuthInfo struct {
	RedirectURI string `json:"redirect_uri"`
	State       string `json:"state"`
	Scope       string `json:"scope"`
	AppID       string `json:"app_id"`
}

// OAuther 第三方 OAuth 客户端接口
type OAuther interface {
	GetAuthorizeInfo() (*OAuthInfo, error)
	GetAuthorizeURL() (state string, url string)
	GetUserInfo(code string) (*OAuthUserInfo, error)
}
