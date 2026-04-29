package usecase

import (
	"testing"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestValidateAttachmentURLsAllowsEmpty(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	if err := validateAttachmentURLs(nil, cfg); err != nil {
		t.Fatalf("validateAttachmentURLs(nil) error = %v", err)
	}
	if err := validateAttachmentURLs([]string{}, cfg); err != nil {
		t.Fatalf("validateAttachmentURLs(empty) error = %v", err)
	}
}

func TestValidateAttachmentURLsAllowsConfiguredPrefix(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	err := validateAttachmentURLs([]string{"https://oss.example.com/temp/a.txt"}, cfg)
	if err != nil {
		t.Fatalf("validateAttachmentURLs() error = %v", err)
	}
}

func TestValidateAttachmentURLsRejectsBadInputs(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	cases := [][]string{
		{""},
		{"ftp://oss.example.com/temp/a.txt"},
		{"https://evil.example.com/temp/a.txt"},
		{
			"https://oss.example.com/temp/1",
			"https://oss.example.com/temp/2",
			"https://oss.example.com/temp/3",
			"https://oss.example.com/temp/4",
			"https://oss.example.com/temp/5",
			"https://oss.example.com/temp/6",
			"https://oss.example.com/temp/7",
			"https://oss.example.com/temp/8",
			"https://oss.example.com/temp/9",
			"https://oss.example.com/temp/10",
			"https://oss.example.com/temp/11",
		},
	}

	for _, urls := range cases {
		if err := validateAttachmentURLs(urls, cfg); err == nil {
			t.Fatalf("validateAttachmentURLs(%#v) error = nil, want error", urls)
		}
	}
}
