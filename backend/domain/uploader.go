package domain

import (
	"mime/multipart"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

type UploadReq struct {
	Usage consts.UploadUsage    `json:"usage" form:"usage" validate:"required,oneof=avatar spec repo"`
	File  *multipart.FileHeader `json:"file" form:"file"`
}

type PresignReq struct {
	Filename string `json:"filename" form:"filename" validate:"required"`
}

type PresignResp struct {
	UploadURL string `json:"upload_url"`
	AccessURL string `json:"access_url"`
}
