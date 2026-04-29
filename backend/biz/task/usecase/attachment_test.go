package usecase

import (
	"testing"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestValidateAttachmentsAllowsEmpty(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	if err := validateAttachments(nil, cfg); err != nil {
		t.Fatalf("validateAttachments(nil) error = %v", err)
	}
	if err := validateAttachments([]domain.TaskAttachment{}, cfg); err != nil {
		t.Fatalf("validateAttachments(empty) error = %v", err)
	}
}

func TestValidateAttachmentsAllowsConfiguredPrefix(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	err := validateAttachments([]domain.TaskAttachment{{URL: "https://oss.example.com/temp/a.txt", Filename: "a.txt"}}, cfg)
	if err != nil {
		t.Fatalf("validateAttachments() error = %v", err)
	}
}

func TestValidateAttachmentsRejectsBadInputs(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	cases := [][]domain.TaskAttachment{
		{{URL: "", Filename: "a.txt"}},
		{{URL: "https://oss.example.com/temp/a.txt", Filename: ""}},
		{{URL: "ftp://oss.example.com/temp/a.txt", Filename: "a.txt"}},
		{{URL: "https://evil.example.com/temp/a.txt", Filename: "a.txt"}},
		{
			{URL: "https://oss.example.com/temp/1", Filename: "1"},
			{URL: "https://oss.example.com/temp/2", Filename: "2"},
			{URL: "https://oss.example.com/temp/3", Filename: "3"},
			{URL: "https://oss.example.com/temp/4", Filename: "4"},
			{URL: "https://oss.example.com/temp/5", Filename: "5"},
			{URL: "https://oss.example.com/temp/6", Filename: "6"},
			{URL: "https://oss.example.com/temp/7", Filename: "7"},
			{URL: "https://oss.example.com/temp/8", Filename: "8"},
			{URL: "https://oss.example.com/temp/9", Filename: "9"},
			{URL: "https://oss.example.com/temp/10", Filename: "10"},
			{URL: "https://oss.example.com/temp/11", Filename: "11"},
		},
	}

	for _, attachments := range cases {
		if err := validateAttachments(attachments, cfg); err == nil {
			t.Fatalf("validateAttachments(%#v) error = nil, want error", attachments)
		}
	}
}
