// Package v1 — 团队管理员 skill 管理 HTTP 入口。契约对齐 main 上的
// /api/v1/teams/skills/* 5 端点(对前端透明),底层换成 agent_skill bare repo
// 模型(scope_type=team, source_type=bare)。
package v1

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

const defaultSkillPackageMaxSize int64 = 50 << 20 // 50 MiB fallback

type TeamSkillHandler struct {
	usecase domain.TeamSkillUsecase
	cfg     *config.Config
}

func NewTeamSkillHandler(i *do.Injector) (*TeamSkillHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamSkillHandler{
		usecase: do.MustInvoke[domain.TeamSkillUsecase](i),
		cfg:     do.MustInvoke[*config.Config](i),
	}

	g := w.Group("/api/v1/teams/skills")
	g.Use(auth.TeamAuth())
	g.GET("", web.BaseHandler(h.List))
	g.POST("", web.BindHandler(h.Add), audit.Audit("add_team_skill"))
	g.POST("/package", web.BindHandler(h.AddPackage), audit.Audit("add_team_skill_package"))
	g.PUT("/:skill_id", web.BindHandler(h.Update), audit.Audit("update_team_skill"))
	g.DELETE("/:skill_id", web.BindHandler(h.Delete), audit.Audit("delete_team_skill"))

	return h, nil
}

type addTeamSkillPackageFormReq struct {
	Name            string                `form:"name" validate:"required"`
	Description     string                `form:"description" validate:"required"`
	Tags            string                `form:"tags"`
	Content         string                `form:"content"`
	GroupIDs        string                `form:"group_ids"`
	SkillMDPath     string                `form:"skill_md_path"`
	IsForceDelivery bool                  `form:"is_force_delivery"`
	SourceType      string                `form:"source_type"`
	SourceLabel     string                `form:"source_label"`
	File            *multipart.FileHeader `form:"file" validate:"required"`
}

// List 团队 Skill 列表
//
//	@Summary	获取团队 Skill 列表
//	@Tags		【Team 管理员】Skill 管理
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Success	200	{object}	web.Resp{data=domain.ListTeamSkillsResp}	"成功"
//	@Failure	401	{object}	web.Resp									"未授权"
//	@Failure	500	{object}	web.Resp									"服务器内部错误"
//	@Router		/api/v1/teams/skills [get]
func (h *TeamSkillHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Add 通过 JSON 添加(content 字段为 SKILL.md 全文)
//
//	@Summary	添加团队 Skill (JSON)
//	@Tags		【Team 管理员】Skill 管理
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		req	body		domain.AddTeamSkillReq			true	"请求参数"
//	@Success	200	{object}	web.Resp{data=domain.TeamSkill}	"成功"
//	@Failure	401	{object}	web.Resp						"未授权"
//	@Failure	500	{object}	web.Resp						"服务器内部错误"
//	@Router		/api/v1/teams/skills [post]
func (h *TeamSkillHandler) Add(c *web.Context, req domain.AddTeamSkillReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Add(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// AddPackage multipart 上传 zip
//
//	@Summary	添加团队 Skill (multipart zip)
//	@Tags		【Team 管理员】Skill 管理
//	@Security	MonkeyCodeAITeamAuth
//	@Accept		multipart/form-data
//	@Produce	json
//	@Param		name			formData	string							true	"Skill 名称"
//	@Param		description		formData	string							true	"Skill 描述"
//	@Param		tags			formData	string							false	"JSON 字符串数组"
//	@Param		content			formData	string							false	"SKILL.md 原文(可选)"
//	@Param		group_ids		formData	string							false	"JSON 字符串数组"
//	@Param		skill_md_path	formData	string							false	"zip 内 SKILL.md 路径"
//	@Param		file			formData	file							true	"Skill zip 包"
//	@Success	200				{object}	web.Resp{data=domain.TeamSkill}	"成功"
//	@Failure	401				{object}	web.Resp						"未授权"
//	@Failure	500				{object}	web.Resp						"服务器内部错误"
//	@Router		/api/v1/teams/skills/package [post]
func (h *TeamSkillHandler) AddPackage(c *web.Context, req addTeamSkillPackageFormReq) error {
	teamUser := middleware.GetTeamUser(c)
	data, err := h.readPackageFile(req.File)
	if err != nil {
		return err
	}
	tags, err := parseStringSlice(req.Tags)
	if err != nil {
		return err
	}
	groupIDs, err := parseUUIDSlice(req.GroupIDs)
	if err != nil {
		return err
	}
	resp, err := h.usecase.AddPackage(c.Request().Context(), teamUser, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{
			Name:            req.Name,
			Description:     req.Description,
			Tags:            tags,
			Content:         req.Content,
			GroupIDs:        groupIDs,
			SkillMDPath:     req.SkillMDPath,
			IsForceDelivery: req.IsForceDelivery,
			SourceType:      req.SourceType,
			SourceLabel:     req.SourceLabel,
		},
		PackageFilename: req.File.Filename,
		PackageData:     data,
	})
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新团队 Skill
//
//	@Summary		更新团队 Skill
//	@Description	请求参数的 content 非空时，后端将 SKILL.md 重新打包上传 OSS 并创建新的 agent_skill_versions 并切到 active version 到新版本，否则仅更新当前版本的 description / tags / is_force_delivery / group_ids
//	@Tags			【Team 管理员】Skill 管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			skill_id	path		string							true	"Skill ID"
//	@Param			req			body		domain.UpdateTeamSkillReq		true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.TeamSkill}	"成功"
//	@Failure		401			{object}	web.Resp						"未授权"
//	@Failure		500			{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/skills/{skill_id} [put]
func (h *TeamSkillHandler) Update(c *web.Context, req domain.UpdateTeamSkillReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除团队 Skill (软删 agent_skill 行,bare repo 本体不动)
//
//	@Summary		删除团队 Skill
//	@Description	从本团队 skill repo 中软删所选 agent skill
//	@Tags			【Team 管理员】Skill 管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			skill_id	path		string		true	"Skill ID"
//	@Success		200			{object}	web.Resp	"成功"
//	@Failure		401			{object}	web.Resp	"未授权"
//	@Failure		500			{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/skills/{skill_id} [delete]
func (h *TeamSkillHandler) Delete(c *web.Context, req domain.DeleteTeamSkillReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// ---- helpers ----

func (h *TeamSkillHandler) readPackageFile(fileHeader *multipart.FileHeader) ([]byte, error) {
	if fileHeader == nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("file is required"))
	}
	maxSize := h.cfg.ObjectStorage.MaxSize
	if maxSize <= 0 {
		maxSize = defaultSkillPackageMaxSize
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

func parseStringSlice(raw string) ([]string, error) {
	if raw == "" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid string array"))
	}
	return values, nil
}

func parseUUIDSlice(raw string) ([]uuid.UUID, error) {
	if raw == "" {
		return nil, nil
	}
	var values []uuid.UUID
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid uuid array"))
	}
	return values, nil
}
