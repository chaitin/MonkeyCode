package channel

type apiResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	Code    int    `json:"code"`
	Msg     string `json:"msg"`
}
