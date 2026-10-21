package identity

import (
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"log/slog"
	"net/http"
	"strings"
)

const (
	defaultWorkspaceName = "Monkey AI"
	defaultProductName   = "MonkeyAI"
)

type publicBranding struct {
	WorkspaceName string `json:"workspace_name"`
	ProductName   string `json:"product_name"`
}

func (s *Service) branding(w http.ResponseWriter, r *http.Request) {
	branding := publicBranding{
		WorkspaceName: defaultWorkspaceName,
		ProductName:   defaultProductName,
	}
	if s.settings != nil {
		value, err := s.settings.GetValue(r.Context(), "branding")
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取品牌设置失败，使用默认值", "module", "identity", "operation", "branding", "error", err)
		} else {
			var configured publicBranding
			if err := json.Unmarshal(value, &configured); err != nil {
				logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "解析品牌设置失败，使用默认值", "module", "identity", "operation", "branding", "error", err)
			} else {
				if workspaceName := strings.TrimSpace(configured.WorkspaceName); workspaceName != "" {
					branding.WorkspaceName = workspaceName
				}
				if productName := strings.TrimSpace(configured.ProductName); productName != "" {
					branding.ProductName = productName
				}
			}
		}
	}
	writeJSON(r.Context(), w, http.StatusOK, branding)
}
