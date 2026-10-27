package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
)

type publicLicenseHost struct{}

func (publicLicenseHost) RegisterAdmin(chi.Router) {}
func (publicLicenseHost) PublicLicense(context.Context) (string, bool, error) {
	return "host-machine-code", true, nil
}

func TestConfigurePublicLicense(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		service := identity.NewService(nil, nil, "")
		registrars := []AdminRegistrar{nil}
		if enabled {
			registrars = append(registrars, publicLicenseHost{})
		}
		configurePublicLicense(service, registrars)
		response := httptest.NewRecorder()
		service.AuthRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/branding", nil))
		var got struct {
			MachineCode string `json:"machine_code"`
			Licensed    bool   `json:"has_commercial_license"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || got.Licensed != enabled {
			t.Fatalf("enabled=%v status=%d licensed=%v", enabled, response.Code, got.Licensed)
		}
		if enabled && got.MachineCode != "host-machine-code" || !enabled && got.MachineCode != "" {
			t.Fatalf("enabled=%v machine_code=%q", enabled, got.MachineCode)
		}
	}
}
