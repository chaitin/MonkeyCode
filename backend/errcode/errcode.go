package errcode

import (
	"embed"

	"github.com/GoYoko/web"
)

//go:embed locale.*.toml
var LocalFS embed.FS

var (
	ErrPermission          = web.NewBadRequestErr("err-permission")
	ErrUserNotFound        = web.NewBadRequestErr("err-user-not-found")
	ErrUserLock            = web.NewBadRequestErr("err-user-lock")
	ErrPassword            = web.NewBadRequestErr("err-password")
	ErrAccountAlreadyExist = web.NewBadRequestErr("err-account-already-exist")
	ErrInviteCodeInvalid   = web.NewBadRequestErr("err-invite-code-invalid")
	ErrEmailInvalid        = web.NewBadRequestErr("err-email-invalid")
	ErrOAuthStateInvalid   = web.NewBadRequestErr("err-oauth-state-invalid")
	ErrUnsupportedPlatform = web.NewBadRequestErr("err-unsupported-platform")
	ErrNotInvited          = web.NewBadRequestErr("err-not-invited")
	ErrDingtalkNotEnabled  = web.NewBadRequestErr("err-dingtalk-not-enabled")
	ErrCustomNotEnabled    = web.NewBadRequestErr("err-custom-not-enabled")
	ErrUserLimit           = web.NewBadRequestErr("err-user-limit")
	ErrModelLimit          = web.NewBadRequestErr("err-model-limit")
	ErrSecurityLimit       = web.NewBadRequestErr("err-security-limit")
	ErrOnlyAdmin           = web.NewBadRequestErr("err-only-admin")
	ErrOnlyEnterprise      = web.NewBadRequestErr("err-only-enterprise")
	ErrInvalidSecret       = web.NewBadRequestErr("err-invalid-secret")
	ErrAIEmployeeLimit     = web.NewBadRequestErr("err-ai-employee-limit")
)
