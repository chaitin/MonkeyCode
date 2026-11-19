package dockerapi

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
)

func TestDiagnosticOmitsRemoteResponseAndURL(t *testing.T) {
	for _, err := range []error{fmt.Errorf("prepare: %w", &Error{403, "secret"}), errors.New("prepare: Docker 拉取镜像失败：secret"), &url.Error{Op: "Post", URL: "https://example.invalid/?token=secret", Err: errors.New("超时")}} {
		got := fmt.Sprint(Diagnostic(err))
		if strings.Contains(got, "secret") || got == "" {
			t.Fatal(got)
		}
	}
}
