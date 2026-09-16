package endpoint

import (
	"context"
	"time"
)

func (s *Service) Observe(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			slots := s.slots
			connections := make([]*connection, 0, len(s.connections))
			for c := range s.connections {
				connections = append(connections, c)
			}
			s.mu.Unlock()
			queued, bytes := 0, 0
			for _, c := range connections {
				c.mu.Lock()
				queued += len(c.business) + len(c.errors)
				bytes += c.businessBytes + c.errorBytes + len(c.directory)
				c.mu.Unlock()
			}
			s.logger.Info("端点桥接运行统计", "connections", slots, "queued_messages", queued, "queued_bytes", bytes,
				"routed_messages", s.stats.messages.Load(), "routed_bytes", s.stats.bytes.Load(), "rejected", s.stats.rejected.Load(),
				"rate_limited", s.stats.limited.Load(), "handshake_failures", s.stats.handshakes.Load(),
				"credential_checks", s.stats.verifications.Load(), "credential_check_ns", s.stats.verifyNanos.Load())
		}
	}
}
