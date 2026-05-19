package tui

import (
	"io"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

type Runner struct {
	prog     *tea.Program
	model    *Model
	reporter *Reporter
	bizErr   error
}

func NewRunner(logW io.Writer) *Runner {
	model := NewModel()
	prog := tea.NewProgram(model)
	r := &Runner{
		prog:  prog,
		model: model,
	}
	r.reporter = newReporter(prog, logW)
	return r
}

func (r *Runner) Reporter() steps.Reporter { return r.reporter }
func (r *Runner) Program() *tea.Program    { return r.prog }
func (r *Runner) BizErr() error            { return r.bizErr }

func (r *Runner) Done(err error) {
	r.bizErr = err
	r.prog.Send(doneMsg{err: err})
}

func (r *Runner) Quit() {
	r.prog.Quit()
}

func (r *Runner) Run() error {
	_, err := r.prog.Run()
	return err
}
