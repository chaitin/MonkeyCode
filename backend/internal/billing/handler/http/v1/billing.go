package v1

import (
	"github.com/GoYoko/web"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
)

type BillingHandler struct {
	usecase domain.BillingUsecase
}

func NewBillingHandler(
	w *web.Web,
	usecase domain.BillingUsecase,
	auth *middleware.AuthMiddleware,
) *BillingHandler {
	b := &BillingHandler{
		usecase: usecase,
	}

	g := w.Group("/api/v1/billing")
	g.Use(auth.Auth())

	g.GET("/chat/record", web.BaseHandler(b.ListChatRecord, web.WithPage()))
	g.GET("/completion/record", web.BaseHandler(b.ListCompletionRecord, web.WithPage()))
	g.GET("/completion/info", web.BaseHandler(b.CompletionInfo))
	g.GET("/chat/info", web.BaseHandler(b.ChatInfo))

	return b
}

// ListChatRecord 获取对话记录
//
//	@Tags			Billing
//	@Summary		获取对话记录
//	@Description	获取对话记录
//	@ID				list-chat-record
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListChatRecordResp}
//	@Router			/api/v1/billing/chat/record [get]
func (h *BillingHandler) ListChatRecord(c *web.Context) error {
	records, err := h.usecase.ListChatRecord(c.Request().Context(), c.Page())
	if err != nil {
		return err
	}
	return c.Success(records)
}

// ListCompletionRecord 获取补全记录
//
//	@Tags			Billing
//	@Summary		获取补全记录
//	@Description	获取补全记录
//	@ID				list-completion-record
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListCompletionRecordResp}
//	@Router			/api/v1/billing/completion/record [get]
func (h *BillingHandler) ListCompletionRecord(c *web.Context) error {
	records, err := h.usecase.ListCompletionRecord(c.Request().Context(), c.Page())
	if err != nil {
		return err
	}
	return c.Success(records)
}

// CompletionInfo 获取补全内容
//
//	@Tags			Billing
//	@Summary		获取补全内容
//	@Description	获取补全内容
//	@ID				completion-info
//	@Accept			json
//	@Produce		json
//	@Param			id	query		string	true	"补全记录ID"
//	@Success		200	{object}	web.Resp{data=domain.CompletionInfo}
//	@Router			/api/v1/billing/completion/info [get]
func (h *BillingHandler) CompletionInfo(c *web.Context) error {
	info, err := h.usecase.CompletionInfo(c.Request().Context(), c.QueryParam("id"))
	if err != nil {
		return err
	}
	return c.Success(info)
}

// ChatInfo 获取对话内容
//
//	@Tags			Billing
//	@Summary		获取对话内容
//	@Description	获取对话内容
//	@ID				chat-info
//	@Accept			json
//	@Produce		json
//	@Param			id	query		string	true	"对话记录ID"
//	@Success		200	{object}	web.Resp{data=domain.ChatInfo}
//	@Router			/api/v1/billing/chat/info [get]
func (h *BillingHandler) ChatInfo(c *web.Context) error {
	info, err := h.usecase.ChatInfo(c.Request().Context(), c.QueryParam("id"))
	if err != nil {
		return err
	}
	return c.Success(info)
}
