package tui

import (
	"fmt"
	"io"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

type Reporter struct {
	prog *tea.Program
	logW io.Writer

	respInput   chan inputResult
	respForm    chan formResult
	respMenu    chan menuResult
	respConfirm chan confirmResult
}

func newReporter(prog *tea.Program, logW io.Writer) *Reporter {
	return &Reporter{
		prog:        prog,
		logW:        logW,
		respInput:   make(chan inputResult, 1),
		respForm:    make(chan formResult, 1),
		respMenu:    make(chan menuResult, 1),
		respConfirm: make(chan confirmResult, 1),
	}
}

func (r *Reporter) Log(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	fmt.Fprintln(r.logW, line)
	r.prog.Send(logMsg(line))
}

func (r *Reporter) LogScreen(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	r.prog.Send(logMsg(line))
}

func (r *Reporter) LogFile(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	fmt.Fprintln(r.logW, line)
}

func (r *Reporter) SetStep(title, nextHint string) {
	r.prog.Send(setStepMsg{title: title, hint: nextHint})
}

func (r *Reporter) StartProgress(label string) {
	r.prog.Send(startProgressMsg{label: label})
}

func (r *Reporter) UpdateProgress(downloaded, total int64) {
	r.prog.Send(updateProgressMsg{downloaded: downloaded, total: total})
}

func (r *Reporter) EndProgress() {
	r.prog.Send(endProgressMsg{})
}

func (r *Reporter) AskInput(label, defaultVal string, password bool, validate steps.Validator) (string, error) {
	r.prog.Send(attachInputRespMsg{ch: r.respInput})
	r.prog.Send(askInputMsg{label: label, defaultV: defaultVal, password: password, validate: validate})
	res := <-r.respInput
	return res.value, res.err
}

func (r *Reporter) AskForm(fields []steps.FormField) ([]string, error) {
	r.prog.Send(attachFormRespMsg{ch: r.respForm})
	r.prog.Send(askFormMsg{fields: fields})
	res := <-r.respForm
	return res.values, res.err
}

func (r *Reporter) AskMenu(title string, options []steps.MenuOption) (string, error) {
	r.prog.Send(attachMenuRespMsg{ch: r.respMenu})
	r.prog.Send(askMenuMsg{title: title, options: options})
	res := <-r.respMenu
	return res.value, res.err
}

func (r *Reporter) AskConfirm(prompt string) (bool, error) {
	r.prog.Send(attachConfirmRespMsg{ch: r.respConfirm})
	r.prog.Send(askConfirmMsg{prompt: prompt})
	res := <-r.respConfirm
	return res.value, res.err
}
