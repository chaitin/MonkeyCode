package tui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

type tickMsg time.Time

type logMsg string
type setStepMsg struct{ title, hint string }
type askInputMsg struct {
	label    string
	defaultV string
	password bool
	validate steps.Validator
}
type askMenuMsg struct {
	title   string
	options []steps.MenuOption
}
type askConfirmMsg struct{ prompt string }
type askFormMsg struct{ fields []steps.FormField }
type doneMsg struct{ err error }

type startProgressMsg struct{ label string }
type updateProgressMsg struct {
	downloaded int64
	total      int64
}
type endProgressMsg struct{}

type inputResult struct {
	value string
	err   error
}
type formResult struct {
	values []string
	err    error
}
type menuResult struct {
	value string
	err   error
}
type confirmResult struct {
	value bool
	err   error
}

type attachInputRespMsg struct{ ch chan inputResult }
type attachFormRespMsg struct{ ch chan formResult }
type attachMenuRespMsg struct{ ch chan menuResult }
type attachConfirmRespMsg struct{ ch chan confirmResult }

func tickEvery() tea.Cmd {
	return tea.Tick(80*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}
