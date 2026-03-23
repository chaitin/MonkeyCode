package templates

import (
	_ "embed"
)

//go:embed install.sh.tmpl
var InstallTmpl []byte

//go:embed codex.tmpl
var Codex []byte

//go:embed claude.tmpl
var Claude []byte

//go:embed opencode.tmpl
var OpenCode []byte

//go:embed opencodeauth.tmpl
var OpenCodeAuth []byte

//go:embed reset_password.html.tmpl
var ResetPassword []byte
