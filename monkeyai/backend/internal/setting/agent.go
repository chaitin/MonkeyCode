package setting

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/config", func(w http.ResponseWriter, r *http.Request) {
		config, err := s.AgentConfig(r.Context())
		if err != nil {
			settingError(w, http.StatusInternalServerError, "读取 Agent 配置失败")
			return
		}
		settingJSON(w, http.StatusOK, config)
	})
	router.Get("/config/events", s.events)
}

func (s *Service) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		settingError(w, http.StatusInternalServerError, "当前连接不支持 SSE")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	events, unsubscribe := s.broker.Subscribe()
	defer unsubscribe()
	_, _ = fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-events:
			config, err := s.AgentConfig(r.Context())
			if err != nil {
				return
			}
			payload, err := json.Marshal(map[string]any{"change": event, "config": config})
			if err != nil {
				return
			}
			_, _ = fmt.Fprintf(w, "event: config\nid: %d\ndata: %s\n\n", event.Version, payload)
			flusher.Flush()
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}
