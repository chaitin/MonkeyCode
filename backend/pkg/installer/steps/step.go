package steps

import (
	"fmt"

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
	Progress     Progress
	DockerStatus deploy.DockerStatus
	Input        deploy.CenterEnvInput
	Result       deploy.InstallResult
}

type Progress struct {
	Current int
	Total   int
}

func (p Progress) Prefix() string {
	if p.Current <= 0 || p.Total <= 0 {
		return ""
	}
	return fmt.Sprintf("[%d/%d]", p.Current, p.Total)
}

func (c *Context) Log(format string, args ...any) {
	c.logWith(c.Reporter.Log, format, args...)
}

func (c *Context) LogScreen(format string, args ...any) {
	c.logWith(c.Reporter.LogScreen, format, args...)
}

func (c *Context) LogFile(format string, args ...any) {
	c.logWith(c.Reporter.LogFile, format, args...)
}

func (c *Context) logWith(log func(string, ...any), format string, args ...any) {
	prefix := c.Progress.Prefix()
	if prefix == "" {
		log(format, args...)
		return
	}
	log(prefix+" "+format, args...)
}

type Step interface {
	Name() string
	Run(ctx *Context) error
}
