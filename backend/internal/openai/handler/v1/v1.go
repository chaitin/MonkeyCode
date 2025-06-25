package v1

import (
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rokku-c/go-openai"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
)

type V1Handler struct {
	logger  *slog.Logger
	proxy   domain.Proxy
	usecase domain.OpenAIUsecase
}

func NewV1Handler(
	logger *slog.Logger,
	w *web.Web,
	proxy domain.Proxy,
	usecase domain.OpenAIUsecase,
	middleware *middleware.ProxyMiddleware,
) *V1Handler {
	h := &V1Handler{
		logger:  logger.With(slog.String("handler", "openai")),
		proxy:   proxy,
		usecase: usecase,
	}
	w.GET("/api/config", web.BindHandler(h.GetConfig), middleware.Auth())

	g := w.Group("/v1", middleware.Auth())
	g.GET("/models", web.BaseHandler(h.ModelList))
	g.POST("/completion/accept", web.BindHandler(h.AcceptCompletion))
	g.POST("/chat/completions", web.BindHandler(h.ChatCompletion))
	g.POST("/completions", web.BindHandler(h.Completions))
	g.POST("/embeddings", web.BindHandler(h.Embeddings))
	return h
}

func BadRequest(c *web.Context, msg string) error {
	c.JSON(http.StatusBadRequest, echo.Map{
		"error": echo.Map{
			"message": msg,
			"type":    "invalid_request_error",
		},
	})
	return nil
}

// AcceptCompletion 接受补全请求
//
//	@Tags			OpenAIV1
//	@Summary		接受补全请求
//	@Description	接受补全请求
//	@ID				accept-completion
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.AcceptCompletionReq	true	"补全请求"
//	@Success		200		{object}	web.Resp{}
//	@Router			/v1/completion/accept [post]
func (h *V1Handler) AcceptCompletion(c *web.Context, req domain.AcceptCompletionReq) error {
	if err := h.proxy.AcceptCompletion(c.Request().Context(), &req); err != nil {
		return BadRequest(c, err.Error())
	}
	return nil
}

// ModelList 模型列表
//
//	@Tags			OpenAIV1
//	@Summary		模型列表
//	@Description	模型列表
//	@ID				model-list
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.ModelListResp}
//	@Router			/v1/models [get]
func (h *V1Handler) ModelList(c *web.Context) error {
	resp, err := h.usecase.ModelList(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ChatCompletion 处理聊天补全请求
//
//	@Tags			OpenAIV1
//	@Summary		处理聊天补全请求
//	@Description	处理聊天补全请求
//	@ID				chat-completion
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}
//	@Router			/v1/chat/completions [post]
func (h *V1Handler) ChatCompletion(c *web.Context, req openai.ChatCompletionRequest) error {
	// TODO: 记录请求到文件
	if req.Model == "" {
		return BadRequest(c, "模型不能为空")
	}
	h.logger.With("request", req).DebugContext(c.Request().Context(), "处理聊天补全请求")

	// if len(req.Tools) > 0 && req.Model != "qwen-max" {
	// 	if h.toolsCall(c, req, req.Stream, req.Model) {
	// 		return nil
	// 	}
	// }

	h.proxy.HandleChatCompletion(c.Request().Context(), c.Response(), &req)
	return nil
}

// Completions 处理文本补全请求
//
//	@Tags			OpenAIV1
//	@Summary		处理文本补全请求
//	@Description	处理文本补全请求
//	@ID				completions
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}
//	@Router			/v1/completions [post]
func (h *V1Handler) Completions(c *web.Context, req domain.CompletionRequest) error {
	// TODO: 记录请求到文件
	if req.Model == "" {
		return BadRequest(c, "模型不能为空")
	}
	h.logger.With("request", req).DebugContext(c.Request().Context(), "处理文本补全请求")
	h.proxy.HandleCompletion(c.Request().Context(), c.Response(), req)
	return nil
}

// Embeddings 处理嵌入请求
//
//	@Tags			OpenAIV1
//	@Summary		处理嵌入请求
//	@Description	处理嵌入请求
//	@ID				embeddings
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}
//	@Router			/v1/embeddings [post]
func (h *V1Handler) Embeddings(c *web.Context, req openai.EmbeddingRequest) error {
	if req.Model == "" {
		return BadRequest(c, "模型不能为空")
	}

	h.proxy.HandleEmbeddings(c.Request().Context(), c.Response(), &req)
	return nil
}

func (h *V1Handler) GetConfig(c *web.Context, req domain.ConfigReq) error {
	key := middleware.GetApiKey(c)
	req.Key = key.Key
	resp, err := h.usecase.GetConfig(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
