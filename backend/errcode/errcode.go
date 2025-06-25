package errcode

import (
	"embed"

	"github.com/GoYoko/web"
)

//go:embed locale.*.toml
var LocalFS embed.FS

var (
	ErrPermission        = web.NewBadRequestErr("err-permission")
	ErrUserNotFound      = web.NewBadRequestErr("err-user-not-found")
	ErrPassword          = web.NewBadRequestErr("err-password")
	ErrInviteCodeInvalid = web.NewBadRequestErr("err-invite-code-invalid")
	ErrEmailInvalid      = web.NewBadRequestErr("err-email-invalid")
)
