package captcha

import (
	"context"
	"testing"
)

func TestValidateTokenRespectsEnabled(t *testing.T) {
	ctx := context.Background()

	if NewCaptcha().ValidateToken(ctx, "") {
		t.Fatal("enabled captcha accepted an empty token")
	}
	if !NewCaptcha(false).ValidateToken(ctx, "") {
		t.Fatal("disabled captcha rejected an empty token")
	}

	cap := NewCaptcha()
	cap.SetEnabled(false)
	if !cap.ValidateToken(ctx, "") {
		t.Fatal("SetEnabled(false) did not disable validation")
	}
}
