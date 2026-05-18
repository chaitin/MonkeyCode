package app

import (
	"strings"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/logging"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/tui"
)

type Action struct {
	Label string
	Value string
	Steps []steps.Step
}

type App struct {
	Title       string
	Banner      string
	Description string
	Actions     []Action
	Logger      *logging.Logger
}

func (a *App) Run() int {
	runner := tui.NewRunner(a.Logger.Plain())
	reporter := runner.Reporter()

	go func() {
		if a.Banner != "" {
			for _, line := range splitBanner(a.Banner) {
				reporter.Log("%s", centerLine(line, 80))
			}
		}
		if a.Description != "" {
			reporter.Log("%s", centerLine(a.Description, 80))
			reporter.Log("")
		}

		reporter.Log("开始记录日志: %s", a.Logger.Path())

		options := make([]steps.MenuOption, 0, len(a.Actions)+1)
		for _, ac := range a.Actions {
			options = append(options, steps.MenuOption{Label: ac.Label, Value: ac.Value})
		}
		options = append(options, steps.MenuOption{Label: "退出", Value: "quit"})

		choice, err := reporter.AskMenu(a.Title, options)
		if err != nil || choice == "quit" {
			runner.Quit()
			return
		}

		var picked Action
		for _, ac := range a.Actions {
			if ac.Value == choice {
				picked = ac
				break
			}
		}
		if picked.Value == "" {
			runner.Quit()
			return
		}

		ctx := &steps.Context{
			Runner:   deploy.CommandRunner{Log: func(line string) { reporter.Log("      %s", line) }},
			Reporter: reporter,
			LogPath:  a.Logger.Path(),
		}
		var failedStep string
		for i, s := range picked.Steps {
			ctx.Progress = steps.Progress{Current: i + 1, Total: len(picked.Steps)}
			if err := s.Run(ctx); err != nil {
				failedStep = s.Name()
				printFailure(reporter, runner, failedStep, err, a.Logger.Path())
				return
			}
		}
		printSuccess(reporter, runner, ctx.Result, a.Logger.Path())
	}()

	if err := runner.Run(); err != nil {
		return 1
	}
	if runner.BizErr() != nil {
		return 1
	}
	return 0
}

func printSuccess(r steps.Reporter, runner *tui.Runner, result deploy.InstallResult, logPath string) {
	r.Log("安装完成")
	if result.URL != "" {
		r.Log("  访问地址:   %s", result.URL)
	}
	if result.AdminEmail != "" {
		r.Log("  管理员账号: %s", result.AdminEmail)
	}
	if result.AdminPassword != "" {
		r.LogScreen("  管理员密码: %s", result.AdminPassword)
		r.LogFile("  管理员密码: ********")
	}
	r.Log("  完整日志:   %s", logPath)
	runner.Done(nil)
}

func printFailure(r steps.Reporter, runner *tui.Runner, stepName string, err error, logPath string) {
	r.Log("操作失败")
	r.Log("  失败步骤: %s", stepName)
	r.Log("  错误信息: %v", err)
	r.Log("  完整日志: %s", logPath)
	runner.Done(err)
}

func splitBanner(b string) []string {
	out := []string{}
	cur := ""
	for _, ch := range b {
		if ch == '\n' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(ch)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}

func centerLine(line string, width int) string {
	width -= appVisualWidth(line)
	if width <= 0 {
		return line
	}
	return strings.Repeat(" ", width/2) + line
}

func appVisualWidth(line string) int {
	n := 0
	for _, r := range line {
		if r >= 0x4E00 && r <= 0x9FFF {
			n += 2
			continue
		}
		n++
	}
	return n
}
