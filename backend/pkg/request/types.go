package request

type Ctx struct {
	body        any
	header      Header
	query       Query
	contentType string
}

type Response[T any] struct {
	Code    int    `json:"code"`
	Data    T      `json:"data"`
	Message string `json:"message"`
}

type Query map[string]string
type Header map[string]string
