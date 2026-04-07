package v1

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/labstack/echo/v4"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// FileHandler VM 内文件管理处理器
type FileHandler struct {
	logger   *slog.Logger
	taskflow taskflow.Clienter
	usecase  domain.HostUsecase
}

// NewFileHandler 创建文件管理处理器
func NewFileHandler(i *do.Injector) (*FileHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	f := &FileHandler{
		logger:   do.MustInvoke[*slog.Logger](i).With("module", "handler.file"),
		taskflow: do.MustInvoke[taskflow.Clienter](i),
		usecase:  do.MustInvoke[domain.HostUsecase](i),
	}

	g := w.Group("/api/v1/users")
	g.Use(auth.Auth(), targetActive.TargetActive())

	g.GET("/folders", web.BindHandler(f.ListFolder))
	g.POST("/folders", web.BindHandler(f.Mkdir))
	g.PUT("/files/move", web.BindHandler(f.Move))
	g.POST("/files/copy", web.BindHandler(f.Copy))
	g.DELETE("/files", web.BindHandler(f.Delete))
	g.PUT("/files/save", web.BindHandler(f.Save))
	g.POST("/files/upload", web.BaseHandler(f.Upload))
	g.GET("/files/download", web.BindHandler(f.Download))

	return f, nil
}

func wraperr(err error, path string) error {
	if err == nil {
		return err
	}
	if strings.Contains(err.Error(), "permission denied") {
		return errcode.ErrFilePermisionDenied.Wrap(err).WithParam("file", path)
	}
	if strings.Contains(err.Error(), "stream not found") {
		return errcode.ErrStreamDisconnect.Wrap(err)
	}
	if strings.Contains(err.Error(), "virtual_machine not found") {
		return errcode.ErrVmRemoved.Wrap(err)
	}
	return errcode.ErrFileOp.Wrap(err)
}

// ListFolder 目录列表
//
//	@Summary		目录列表
//	@Description	目录列表
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	query		domain.FilePathReq				false	"参数"
//	@Success		200		{object}	web.Resp{data=[]taskflow.File}	"成功"
//	@Router			/api/v1/users/folders [get]
func (f *FileHandler) ListFolder(c *web.Context, req domain.FilePathReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		fs, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpList,
			Path:    req.Path,
		})
		if err != nil {
			return err
		}
		return c.Success(fs)
	}), req.Path)
}

// Mkdir 创建目录
//
//	@Summary		创建目录
//	@Description	创建目录
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.FilePathReq	false	"参数"
//	@Success		200		{object}	web.Resp{}			"成功"
//	@Router			/api/v1/users/folders [post]
func (f *FileHandler) Mkdir(c *web.Context, req domain.FilePathReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		_, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpMkdir,
			Path:    req.Path,
		})
		if err != nil {
			f.logger.With("error", err).ErrorContext(c.Request().Context(), "failed to mkdir")
			return err
		}
		return c.Success(nil)
	}), req.Path)
}

// Move 移动文件/目录
//
//	@Summary		移动文件/目录
//	@Description	移动文件/目录
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.FileChangeReq	false	"参数"
//	@Success		200		{object}	web.Resp{}				"成功"
//	@Router			/api/v1/users/files/move [put]
func (f *FileHandler) Move(c *web.Context, req domain.FileChangeReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		_, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpMove,
			Source:  req.Source,
			Target:  req.Target,
		})
		if err != nil {
			return err
		}
		return c.Success(nil)
	}), req.Source)
}

// Copy 复制文件/目录
//
//	@Summary		复制文件/目录
//	@Description	复制文件/目录
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.FileChangeReq	false	"参数"
//	@Success		200		{object}	web.Resp{}				"成功"
//	@Router			/api/v1/users/files/copy [post]
func (f *FileHandler) Copy(c *web.Context, req domain.FileChangeReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		_, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpCopy,
			Source:  req.Source,
			Target:  req.Target,
		})
		if err != nil {
			return err
		}
		return c.Success(nil)
	}), req.Source)
}

// Delete 删除文件/目录
//
//	@Summary		删除文件/目录
//	@Description	删除文件/目录
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	query		domain.FilePathReq	false	"参数"
//	@Success		200		{object}	web.Resp{}			"成功"
//	@Router			/api/v1/users/files [delete]
func (f *FileHandler) Delete(c *web.Context, req domain.FilePathReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		_, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpDelete,
			Path:    req.Path,
		})
		if err != nil {
			return err
		}
		return c.Success(nil)
	}), req.Path)
}

// Save 保存文件内容
//
//	@Summary		保存文件内容
//	@Description	保存文件内容
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.FileSaveReq	false	"参数"
//	@Success		200		{object}	web.Resp{}			"成功"
//	@Router			/api/v1/users/files/save [put]
func (f *FileHandler) Save(c *web.Context, req domain.FileSaveReq) error {
	user := middleware.GetUser(c)
	return wraperr(f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		_, err := f.taskflow.FileManager().Operate(c.Request().Context(), taskflow.FileReq{
			ID:      req.ID,
			Operate: taskflow.FileOpSave,
			Path:    req.Path,
			Content: req.Content,
		})
		if err != nil {
			return err
		}
		return c.Success(nil)
	}), req.Path)
}

// Upload 上传文件
//
//	@Summary		上传文件
//	@Description	上传文件
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		query		string		true	"虚拟机 id"
//	@Param			path	query		string		true	"文件上传的绝对地址"
//	@Param			file	formData	file		true	"文件"
//	@Success		200		{object}	web.Resp{}	"成功"
//	@Router			/api/v1/users/files/upload [post]
func (f *FileHandler) Upload(c *web.Context) error {
	id := c.QueryParam("id")
	path := c.QueryParam("path")
	f.logger.With("id", id, "path", path).DebugContext(c.Request().Context(), "upload file")

	user := middleware.GetUser(c)
	if err := f.usecase.WithVMPermission(c.Request().Context(), user.ID, id, func(v *domain.VirtualMachine) error {
		return nil
	}); err != nil {
		return wraperr(err, path)
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return err
	}
	ff, err := fh.Open()
	if err != nil {
		return fmt.Errorf("failed to open file %s", err)
	}
	defer ff.Close()

	ctx := c.Request().Context()
	const (
		uploadChunkSize  = 1 * 1024 * 1024
		uploadQueueDepth = 16
	)
	data := make(chan []byte, uploadQueueDepth)
	errChan := make(chan error, 1)
	done := make(chan struct{})

	// 创建可取消的 context 给 reader，确保 Upload 返回后能终止 reader
	readerCtx, cancelReader := context.WithCancel(ctx)
	defer cancelReader()

	go func() {
		buf := make([]byte, uploadChunkSize)
		defer close(data)
		defer close(done)
		for {
			n, err := ff.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				select {
				case data <- chunk:
				case <-readerCtx.Done():
					return
				}
			}
			if err == nil {
				continue
			}
			if err == io.EOF {
				break
			}
			f.logger.With("error", err).ErrorContext(ctx, "failed to read upload file")
			select {
			case errChan <- err:
			default:
			}
			return
		}
	}()

	uploadErr := f.taskflow.FileManager().Upload(ctx, taskflow.FileReq{
		ID:   id,
		Path: path,
	}, data)

	// Upload 返回后立即取消 reader，确保 goroutine 能退出
	cancelReader()

	if uploadErr != nil {
		// Best effort: unblock a stalled reader so we can return the upload error promptly.
		if closeErr := ff.Close(); closeErr != nil {
			f.logger.With("error", closeErr).DebugContext(ctx, "failed to close upload file after cancel")
		}
	}

	waitTimeout := 5 * time.Second
	if uploadErr != nil {
		waitTimeout = 200 * time.Millisecond
	}

	// 等待 goroutine 完成（带超时保护）
	timer := time.NewTimer(waitTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		f.logger.ErrorContext(ctx, "timeout waiting for reader goroutine to exit")
		if uploadErr != nil {
			return wraperr(uploadErr, path)
		}
		return fmt.Errorf("timeout waiting for file reader to complete")
	}

	// 检查文件读取错误
	select {
	case err := <-errChan:
		if uploadErr == nil {
			return wraperr(err, path)
		}
		// 两个错误都存在，优先返回 upload 错误
		f.logger.With("read_error", err, "upload_error", uploadErr).ErrorContext(ctx, "multiple errors during upload")
		return wraperr(uploadErr, path)
	default:
	}

	if uploadErr != nil {
		return wraperr(uploadErr, path)
	}

	return c.Success(nil)
}

// Download 下载文件
//
//	@Summary		下载文件
//	@Description	下载文件
//	@Tags			【用户】文件管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	query		domain.FilePathReq	false	"参数"
//	@Success		200		{object}	web.Resp{}			"成功"
//	@Router			/api/v1/users/files/download [get]
func (f *FileHandler) Download(c *web.Context, req domain.FilePathReq) error {
	user := middleware.GetUser(c)
	if err := f.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		return nil
	}); err != nil {
		if strings.Contains(err.Error(), "virtual_machine not found") {
			c.Response().Header().Set("X-Internal-Error", base64.StdEncoding.EncodeToString([]byte("开发环境已被回收")))
			return errcode.ErrVmRemoved.Wrap(err)
		}
		c.Response().Header().Set("X-Internal-Error", base64.StdEncoding.EncodeToString([]byte(err.Error())))
		return errcode.ErrFilePermisionDenied.Wrap(err).WithParam("file", req.Path)
	}

	c.Response().Header().Set("Content-Disposition", "attachment; filename=\"\"")
	c.Response().Header().Set(echo.HeaderContentType, "application/octet-stream")

	err := f.taskflow.FileManager().Download(c.Request().Context(), taskflow.FileReq{
		ID:   req.ID,
		Path: req.Path,
	}, func(size uint64, b []byte) error {
		f.logger.With("size", size, "len", len(b)).DebugContext(c.Request().Context(), "download file chunk")
		if size > 0 {
			c.Response().Header().Set(echo.HeaderContentLength, fmt.Sprintf("%d", size))
		}
		if len(b) > 0 {
			if _, err := c.Response().Writer.Write(b); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.Response().Header().Set("X-Internal-Error", base64.StdEncoding.EncodeToString([]byte(err.Error())))
		f.logger.With("error", err, "req", req).ErrorContext(c.Request().Context(), "failed to download file")
		return err
	}

	return nil
}
