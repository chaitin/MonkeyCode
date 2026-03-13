package domain

type RedeemCaptchaReq struct {
	Token     string  `json:"token"`
	Solutions []int64 `json:"solutions"`
}
