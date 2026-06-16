package v1

import (
	"fmt"
	"io"
	"mime/multipart"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamExtensionPackageHandler struct {
	usecase domain.TeamExtensionPackageUsecase
	cfg     *config.Config
}

func NewTeamExtensionPackageHandler(i *do.Injector) (*TeamExtensionPackageHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamExtensionPackageHandler{
		usecase: do.MustInvoke[domain.TeamExtensionPackageUsecase](i),
		cfg:     do.MustInvoke[*config.Config](i),
	}

	g := w.Group("/api/v1/teams/extension-packages")
	g.Use(auth.TeamAuth())
	g.POST("", web.BindHandler(h.Import), audit.Audit("import_team_extension_package"))

	return h, nil
}

type importTeamExtensionPackageFormReq struct {
	File *multipart.FileHeader `form:"file" validate:"required"`
}

// Import 上传团队扩展包
//
//	@Summary		上传团队扩展包
//	@Description	上传团队扩展包并导入 Skills 和团队镜像记录
//	@Tags			【Team 管理员】扩展包管理
//	@Accept			multipart/form-data
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			file	formData	file													true	"扩展包 zip"
//	@Success		200		{object}	web.Resp{data=domain.ImportTeamExtensionPackageResp}	"成功"
//	@Failure		401		{object}	web.Resp												"未授权"
//	@Failure		500		{object}	web.Resp												"服务器内部错误"
//	@Router			/api/v1/teams/extension-packages [post]
func (h *TeamExtensionPackageHandler) Import(c *web.Context, req importTeamExtensionPackageFormReq) error {
	teamUser := middleware.GetTeamUser(c)
	data, err := h.readPackageFile(req.File)
	if err != nil {
		return err
	}
	resp, err := h.usecase.Import(c.Request().Context(), teamUser, &domain.ImportTeamExtensionPackageReq{
		Filename: req.File.Filename,
		Data:     data,
	})
	if err != nil {
		return err
	}
	return c.Success(resp)
}

func (h *TeamExtensionPackageHandler) readPackageFile(fileHeader *multipart.FileHeader) ([]byte, error) {
	if fileHeader == nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("file is required"))
	}
	maxSize := h.cfg.ObjectStorage.MaxSize
	if maxSize <= 0 {
		maxSize = 50 << 20
	}
	if fileHeader.Size > maxSize {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("file exceeds limit"))
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxSize {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("file exceeds limit"))
	}
	return data, nil
}
