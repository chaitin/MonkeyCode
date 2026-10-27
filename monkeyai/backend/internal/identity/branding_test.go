package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicBranding(t *testing.T) {
	for _, test := range []struct {
		name     string
		settings SettingReader
		want     publicBranding
	}{
		{
			name: "configured",
			settings: authenticationStub{json.RawMessage(
				`{"workspace_name":" Example Team ","product_name":" Example Tool "}`,
			)},
			want: publicBranding{WorkspaceName: "Example Team", ProductName: "Example Tool"},
		},
		{
			name: "defaults without settings",
			want: publicBranding{WorkspaceName: defaultWorkspaceName, ProductName: defaultProductName},
		},
		{
			name:     "defaults for empty values",
			settings: authenticationStub{json.RawMessage(`{"workspace_name":" ","product_name":""}`)},
			want:     publicBranding{WorkspaceName: defaultWorkspaceName, ProductName: defaultProductName},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := NewService(nil, test.settings, "")
			request := httptest.NewRequest(http.MethodGet, "/branding", nil)
			response := httptest.NewRecorder()
			service.AuthRouter().ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control=%q", response.Header().Get("Cache-Control"))
			}
			var got publicBranding
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("branding=%+v want=%+v", got, test.want)
			}
		})
	}
}

type publicLicenseStub struct {
	machine string
	valid   bool
	err     error
}

func (s *publicLicenseStub) PublicLicense(context.Context) (string, bool, error) {
	return s.machine, s.valid, s.err
}

func TestPublicBrandingLicenseWhitelist(t *testing.T) {
	for _, test := range []struct {
		name   string
		reader PublicLicenseReader
		code   string
		valid  bool
	}{
		{name: "no host license reader"},
		{name: "valid paid license", reader: &publicLicenseStub{machine: " machine-code ", valid: true}, code: "machine-code", valid: true},
		{name: "no valid paid license", reader: &publicLicenseStub{machine: "machine-code"}, code: "machine-code"},
		{name: "validation unavailable", reader: &publicLicenseStub{machine: "machine-code", valid: true, err: errors.New("private-license-error")}, code: "machine-code"},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings := authenticationStub{json.RawMessage(`{"workspace_name":"Team","product_name":"Product","machine_code":"forged-code","has_commercial_license":{"secret":"license-secret"},"client_id":"private-client","license":"private-license"}`)}
			service := NewService(nil, settings, "").WithPublicLicense(test.reader)
			response := httptest.NewRecorder()
			service.AuthRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/branding", nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d", response.Code)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control=%q", response.Header().Get("Cache-Control"))
			}
			var got map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if len(got) != 4 || got["workspace_name"] != "Team" || got["product_name"] != "Product" || got["machine_code"] != test.code || got["has_commercial_license"] != test.valid {
				t.Fatalf("unexpected public fields: %+v", got)
			}
		})
	}
}

func TestPublicBrandingLicenseIsNotCached(t *testing.T) {
	reader := &publicLicenseStub{machine: "machine-code", valid: true}
	service := NewService(nil, nil, "").WithPublicLicense(reader)
	for _, valid := range []bool{true, false, true} {
		reader.valid = valid
		response := httptest.NewRecorder()
		service.AuthRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/branding", nil))
		var got publicBranding
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.HasCommercialLicense != valid || got.MachineCode != reader.machine {
			t.Fatalf("branding=%+v", got)
		}
	}
}
