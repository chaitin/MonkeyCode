package steps

import (
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

type Validator func(string) error

type MenuOption struct {
	Label string
	Value string
}

type FormField struct {
	Label    string
	Default  string
	Password bool
	Help     string
	Validate Validator
}

type Reporter interface {
	Log(format string, args ...any)
	LogScreen(format string, args ...any)
	LogFile(format string, args ...any)
	SetStep(title, nextHint string)
	StartProgress(label string)
	UpdateProgress(downloaded, total int64)
	EndProgress()
	AskInput(label, defaultVal string, password bool, validate Validator) (string, error)
	AskForm(fields []FormField) ([]string, error)
	AskMenu(title string, options []MenuOption) (string, error)
	AskConfirm(prompt string) (bool, error)
}

type Context struct {
	Runner       deploy.Runner
	Reporter     Reporter
	LogPath      string
	DockerStatus deploy.DockerStatus
	Input        deploy.CenterEnvInput
	Result       deploy.InstallResult
}

type Step interface {
	Name() string
	Run(ctx *Context) error
}
