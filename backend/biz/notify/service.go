package notify

import (
	"context"
	"log/slog"
	"sync"

	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
)

// Service 通知服务，负责管理事件分发器的生命周期
type Service struct {
	dispatcher *dispatcher.Dispatcher
	logger     *slog.Logger
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

// NewService 创建通知服务
func NewService(
	disp *dispatcher.Dispatcher,
	logger *slog.Logger,
) *Service {
	return &Service{
		dispatcher: disp,
		logger:     logger.With("module", "notify.service"),
	}
}

// Start 启动通知服务
func (s *Service) Start(ctx context.Context) {
	ctx, s.cancel = context.WithCancel(ctx)

	// 启动事件分发器
	s.dispatcher.Start(ctx)

	s.logger.InfoContext(ctx, "notify service started")
}

// Close 停止通知服务
func (s *Service) Close() {
	if s.cancel != nil {
		s.cancel()
	}
	s.dispatcher.Close()
	s.wg.Wait()
	s.logger.Info("notify service stopped")
}
