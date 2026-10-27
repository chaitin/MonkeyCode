package identity

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

const (
	defaultWorkspaceName = "Monkey AI"
	defaultProductName   = "MonkeyAI"
)

// PublicLicenseReader returns only deployment information intended for anonymous
// clients. The host must reuse its paid-license validation, including signature,
// machine binding and validity period; an uploaded but invalid license is false.
type PublicLicenseReader interface {
	PublicLicense(context.Context) (machineCode string, hasCommercialLicense bool, err error)
}

func (s *Service) WithPublicLicense(reader PublicLicenseReader) *Service {
	s.publicLicense = reader
	return s
}

type publicBranding struct {
	WorkspaceName        string `json:"workspace_name"`
	ProductName          string `json:"product_name"`
	MachineCode          string `json:"machine_code"`
	HasCommercialLicense bool   `json:"has_commercial_license"`
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
			var configured struct {
				WorkspaceName string `json:"workspace_name"`
				ProductName   string `json:"product_name"`
			}
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
	if s.publicLicense != nil {
		machineCode, licensed, err := s.publicLicense.PublicLicense(r.Context())
		branding.MachineCode = strings.TrimSpace(machineCode)
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.branding.license.failed", "读取公开授权状态失败，按未授权处理", "module", "identity", "operation", "branding")
		} else {
			branding.HasCommercialLicense = licensed
		}
	}
	writeJSON(r.Context(), w, http.StatusOK, branding)
}
