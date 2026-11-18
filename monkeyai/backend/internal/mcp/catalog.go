package mcp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func (s *Service) catalogTools(ctx context.Context, q resource.Queryer, connector, credential, view resource.Object) ([]resource.Object, error) {
	tools, err := s.liveTools(ctx, q, connector, credential, false)
	if err == nil {
		return tools, nil
	}
	if ctx.Err() != nil {
		return nil, err
	}
	var fault *resource.Error
	if !errors.As(err, &fault) || fault.Status != http.StatusBadGateway {
		return nil, err
	}
	// 目录中的工具仅用于兼容旧客户端，远端故障不能阻断资源配置。
	if fault.Cause != nil {
		err = fault.Cause
	}
	logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.catalog.tools.failed", "读取连接工具失败，保留连接并继续返回目录",
		"connector_id", connector.String("id"), "resource_id", credential.String("id"), "upstream_error_code", fault.Code, "error", err)
	view["connection_status"] = "error"
	return []resource.Object{}, nil
}
