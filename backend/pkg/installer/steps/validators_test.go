package steps

import "testing"

func TestValidateAccessHost(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "ipv4", value: "192.168.1.10"},
		{name: "ipv6", value: "2001:db8::1"},
		{name: "domain", value: "monkeycode.example.com"},
		{name: "empty", value: "", wantErr: true},
		{name: "url", value: "http://monkeycode.example.com", wantErr: true},
		{name: "host port", value: "monkeycode.example.com:8080", wantErr: true},
		{name: "path", value: "monkeycode.example.com/app", wantErr: true},
		{name: "single label", value: "monkeycode", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAccessHost(tt.value)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateAccessHost(%q) err = %v, wantErr %v", tt.value, err, tt.wantErr)
			}
		})
	}
}

func TestValidatePort(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "min", value: "1"},
		{name: "default", value: "80"},
		{name: "max", value: "65535"},
		{name: "zero", value: "0", wantErr: true},
		{name: "too large", value: "65536", wantErr: true},
		{name: "not number", value: "http", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePort(tt.value)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validatePort(%q) err = %v, wantErr %v", tt.value, err, tt.wantErr)
			}
		})
	}
}

func TestValidateEmail(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "valid", value: "admin@example.com"},
		{name: "display name", value: "Admin <admin@example.com>", wantErr: true},
		{name: "missing domain", value: "admin@", wantErr: true},
		{name: "empty", value: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateEmail(tt.value)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateEmail(%q) err = %v, wantErr %v", tt.value, err, tt.wantErr)
			}
		})
	}
}
