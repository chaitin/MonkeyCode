package steps

import "fmt"

type fakeReporter struct {
	Logs      []string
	StepCalls []string

	InputAns   []string
	FormAns    [][]string
	MenuAns    []string
	ConfirmAns []bool

	inputIdx, formIdx, menuIdx, confirmIdx int
}

func (r *fakeReporter) Log(format string, args ...any) {
	r.Logs = append(r.Logs, fmt.Sprintf(format, args...))
}

func (r *fakeReporter) LogScreen(format string, args ...any) {
	r.Logs = append(r.Logs, fmt.Sprintf(format, args...))
}

func (r *fakeReporter) LogFile(format string, args ...any) {}

func (r *fakeReporter) SetStep(title, hint string) {
	r.StepCalls = append(r.StepCalls, title)
}

func (r *fakeReporter) StartProgress(label string)               {}
func (r *fakeReporter) UpdateProgress(downloaded, total int64)   {}
func (r *fakeReporter) EndProgress()                              {}

func (r *fakeReporter) AskInput(label, def string, password bool, v Validator) (string, error) {
	if r.inputIdx >= len(r.InputAns) {
		return def, nil
	}
	a := r.InputAns[r.inputIdx]
	r.inputIdx++
	if v != nil {
		if err := v(a); err != nil {
			return "", err
		}
	}
	return a, nil
}

func (r *fakeReporter) AskForm(fields []FormField) ([]string, error) {
	if r.formIdx >= len(r.FormAns) {
		out := make([]string, len(fields))
		for i, f := range fields {
			out[i] = f.Default
		}
		return out, nil
	}
	a := r.FormAns[r.formIdx]
	r.formIdx++
	for i, f := range fields {
		if f.Validate != nil && i < len(a) {
			if err := f.Validate(a[i]); err != nil {
				return nil, err
			}
		}
	}
	return a, nil
}

func (r *fakeReporter) AskMenu(title string, opts []MenuOption) (string, error) {
	if r.menuIdx >= len(r.MenuAns) {
		return opts[0].Value, nil
	}
	a := r.MenuAns[r.menuIdx]
	r.menuIdx++
	return a, nil
}

func (r *fakeReporter) AskConfirm(prompt string) (bool, error) {
	if r.confirmIdx >= len(r.ConfirmAns) {
		return false, nil
	}
	a := r.ConfirmAns[r.confirmIdx]
	r.confirmIdx++
	return a, nil
}
