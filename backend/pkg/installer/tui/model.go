package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

type Model struct {
	logs  []string
	state footerState
	tick  int
	width int

	progressActive bool
	progressLabel  string
	progressDone   int64
	progressTotal  int64
	progressStart  time.Time

	pendingInput   *askInputMsg
	pendingMenu    *askMenuMsg
	pendingConfirm *askConfirmMsg
	pendingForm    *askFormMsg
	formIdx        int      // 当前正在填的字段索引
	formValues     []string // 已填字段
	formPhase      int      // 0=填字段 1=确认页
	formConfirmSel int      // 0=确认 1=重填
	input          textinput.Model

	menuSel    int
	confirmYes bool

	respInput   chan inputResult
	respForm    chan formResult
	respMenu    chan menuResult
	respConfirm chan confirmResult

	doneErr  error
	finished bool
}

func NewModel() *Model {
	ti := textinput.New()
	ti.Prompt = ""
	return &Model{
		state: footerExit{message: "准备中..."},
		input: ti,
		width: 80,
	}
}

func (m *Model) Init() tea.Cmd {
	return tickEvery()
}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil

	case tickMsg:
		m.tick++
		return m, tickEvery()

	case logMsg:
		m.logs = append(m.logs, string(msg))
		return m, nil

	case setStepMsg:
		m.state = footerStatus{title: msg.title, nextHint: msg.hint}
		return m, nil

	case startProgressMsg:
		m.progressActive = true
		m.progressLabel = msg.label
		m.progressDone = 0
		m.progressTotal = 0
		m.progressStart = time.Now()
		return m, nil

	case updateProgressMsg:
		if m.progressActive {
			m.progressDone = msg.downloaded
			m.progressTotal = msg.total
		}
		return m, nil

	case endProgressMsg:
		if m.progressActive {
			elapsed := time.Since(m.progressStart)
			m.logs = append(m.logs, fmt.Sprintf("✓ %s 完成 · 耗时 %s", m.progressLabel, formatDuration(elapsed)))
			m.progressActive = false
			m.progressLabel = ""
		}
		return m, nil

	case attachInputRespMsg:
		m.respInput = msg.ch
		return m, nil
	case attachFormRespMsg:
		m.respForm = msg.ch
		return m, nil
	case attachMenuRespMsg:
		m.respMenu = msg.ch
		return m, nil
	case attachConfirmRespMsg:
		m.respConfirm = msg.ch
		return m, nil

	case askFormMsg:
		m.pendingForm = &msg
		m.formIdx = 0
		m.formValues = make([]string, len(msg.fields))
		m.formPhase = 0
		m.startFormField()
		return m, textinput.Blink

	case askInputMsg:
		m.pendingInput = &msg
		m.input.SetValue(msg.defaultV)
		m.input.EchoMode = textinput.EchoNormal
		if msg.password {
			m.input.EchoMode = textinput.EchoPassword
		}
		m.input.Focus()
		m.state = footerInput{label: msg.label, value: msg.defaultV, password: msg.password, cursor: true}
		return m, textinput.Blink

	case askMenuMsg:
		m.pendingMenu = &msg
		m.menuSel = 0
		m.state = footerMenu{options: msg.options, selected: 0}
		return m, nil

	case askConfirmMsg:
		m.pendingConfirm = &msg
		m.confirmYes = false
		m.logs = append(m.logs, " "+msg.prompt)
		m.state = footerConfirm{prompt: msg.prompt, yesFocus: false}
		return m, nil

	case doneMsg:
		m.finished = true
		m.doneErr = msg.err
		message := "退出"
		if msg.err != nil {
			message = "退出 (出错)"
		}
		m.state = footerExit{message: message}
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

func (m *Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.Type == tea.KeyCtrlC {
		return m, tea.Quit
	}

	switch {
	case m.pendingForm != nil:
		return m.handleFormKey(msg)
	case m.pendingInput != nil:
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		if msg.Type == tea.KeyEnter {
			val := m.input.Value()
			if val == "" {
				val = m.pendingInput.defaultV
			}
			if m.pendingInput.validate != nil {
				if err := m.pendingInput.validate(val); err != nil {
					m.state = footerInput{
						label:    m.pendingInput.label,
						value:    val,
						password: m.pendingInput.password,
						hint:     err.Error(),
						cursor:   true,
					}
					return m, nil
				}
			}
			respCh := m.respInput
			m.pendingInput = nil
			m.respInput = nil
			respCh <- inputResult{value: val}
			return m, nil
		}
		m.state = footerInput{
			label:    m.pendingInput.label,
			value:    m.input.Value(),
			password: m.pendingInput.password,
			cursor:   true,
		}
		return m, cmd

	case m.pendingMenu != nil:
		opts := m.pendingMenu.options
		switch msg.String() {
		case "up", "k":
			if m.menuSel > 0 {
				m.menuSel--
			}
		case "down", "j":
			if m.menuSel < len(opts)-1 {
				m.menuSel++
			}
		case "enter":
			val := opts[m.menuSel].Value
			respCh := m.respMenu
			m.pendingMenu = nil
			m.respMenu = nil
			respCh <- menuResult{value: val}
			return m, nil
		}
		m.state = footerMenu{options: opts, selected: m.menuSel}
		return m, nil

	case m.pendingConfirm != nil:
		switch msg.String() {
		case "up", "k":
			m.confirmYes = true
		case "down", "j":
			m.confirmYes = false
		case "enter":
			respCh := m.respConfirm
			val := m.confirmYes
			m.pendingConfirm = nil
			m.respConfirm = nil
			respCh <- confirmResult{value: val}
			return m, nil
		}
		m.state = footerConfirm{prompt: m.pendingConfirm.prompt, yesFocus: m.confirmYes}
		return m, nil

	case m.finished:
		if msg.Type == tea.KeyEnter {
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m *Model) startFormField() {
	field := m.pendingForm.fields[m.formIdx]
	cur := m.formValues[m.formIdx]
	if cur == "" {
		cur = field.Default
	}
	m.input.SetValue(cur)
	m.input.EchoMode = textinput.EchoNormal
	m.input.Focus()
	m.refreshFormState("")
}

func (m *Model) refreshFormState(hintErr string) {
	field := m.pendingForm.fields[m.formIdx]
	hint := field.Help
	if hintErr != "" {
		hint = hintErr
	}
	m.state = footerForm{
		fields:    m.pendingForm.fields,
		values:    m.formValues,
		cur:       m.formIdx,
		inputView: m.input.View(),
		hint:      hint,
	}
}

func (m *Model) showFormConfirm() {
	rows := make([]formSummaryRow, len(m.pendingForm.fields))
	for i, f := range m.pendingForm.fields {
		rows[i] = formSummaryRow{label: f.Label, value: m.formValues[i], password: f.Password}
	}
	m.formConfirmSel = 0
	m.state = footerFormConfirm{rows: rows, selected: 0}
}

func (m *Model) handleFormKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.formPhase == 1 {
		switch msg.String() {
		case "up", "k":
			m.formConfirmSel = 0
		case "down", "j":
			m.formConfirmSel = 1
		case "enter":
			if m.formConfirmSel == 0 {
				respCh := m.respForm
				vals := m.formValues
				m.pendingForm = nil
				m.respForm = nil
				m.formValues = nil
				respCh <- formResult{values: vals}
				return m, nil
			}
			// 重填
			m.formIdx = 0
			m.formValues = make([]string, len(m.pendingForm.fields))
			m.formPhase = 0
			m.startFormField()
			return m, nil
		}
		m.state = footerFormConfirm{
			rows:     m.state.(footerFormConfirm).rows,
			selected: m.formConfirmSel,
		}
		return m, nil
	}

	field := m.pendingForm.fields[m.formIdx]
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)

	switch msg.Type {
	case tea.KeyEnter:
		val := m.input.Value()
		if val == "" {
			val = field.Default
		}
		if field.Validate != nil {
			if err := field.Validate(val); err != nil {
				m.refreshFormState(err.Error())
				return m, nil
			}
		}
		m.formValues[m.formIdx] = val
		if m.formIdx+1 < len(m.pendingForm.fields) {
			m.formIdx++
			m.startFormField()
			return m, textinput.Blink
		}
		m.formPhase = 1
		m.showFormConfirm()
		return m, nil
	case tea.KeyUp:
		if m.formIdx > 0 {
			m.formValues[m.formIdx] = m.input.Value()
			m.formIdx--
			m.startFormField()
			return m, textinput.Blink
		}
	}

	m.refreshFormState("")
	return m, cmd
}

func (m *Model) View() string {
	var b strings.Builder
	for _, line := range m.logs {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	if m.progressActive {
		b.WriteString(renderProgress(m.progressLabel, m.progressDone, m.progressTotal, m.width, m.tick))
		b.WriteByte('\n')
	}
	b.WriteString(renderFooter(m.state, m.width, m.tick))
	return b.String()
}

func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	if d < time.Minute {
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
	min := int(d / time.Minute)
	sec := int((d % time.Minute) / time.Second)
	return fmt.Sprintf("%dm%ds", min, sec)
}
