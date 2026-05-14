package tui

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
	"github.com/charmbracelet/lipgloss"
)

const chaseLen = 3

var (
	borderStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	hintStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Faint(true).Italic(true)
	titleStyle  = lipgloss.NewStyle().Bold(true)
	chaseStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("238")).Faint(true)
	selectStyle = lipgloss.NewStyle().Bold(true)
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
)

type footerState interface {
	render(width, tick int) string
}

type footerMenu struct {
	options  []steps.MenuOption
	selected int
}

type footerStatus struct {
	title    string
	nextHint string
}

type footerInput struct {
	label    string
	value    string
	password bool
	hint     string
	cursor   bool
}

type footerConfirm struct {
	prompt   string
	yesFocus bool
}

type footerExit struct {
	message string
}

type formSummaryRow struct {
	label    string
	value    string
	password bool
}

type footerFormConfirm struct {
	rows     []formSummaryRow
	selected int // 0 = 确认, 1 = 重填
}

type footerForm struct {
	fields    []steps.FormField
	values    []string
	cur       int
	inputView string
	hint      string
}

func renderFooter(s footerState, width, tick int) string {
	if width < 20 {
		width = 20
	}
	return s.render(width, tick)
}

func line(width int) string {
	return borderStyle.Render(strings.Repeat("─", width))
}

func wrapBox(width int, mainLine, subLine string) string {
	var b strings.Builder
	b.WriteString(line(width))
	b.WriteByte('\n')
	b.WriteString(mainLine)
	b.WriteByte('\n')
	b.WriteString(line(width))
	if subLine != "" {
		b.WriteByte('\n')
		b.WriteString(subLine)
	}
	return b.String()
}

func chasingPositions(textLen, tick int) []int {
	if textLen < 1 {
		textLen = 1
	}
	span := textLen + chaseLen
	out := make([]int, chaseLen)
	for i := 0; i < chaseLen; i++ {
		out[i] = (tick + i) % span
	}
	return out
}

func renderChase(text string, tick int) string {
	runes := []rune(text)
	n := len(runes)
	pos := chasingPositions(n, tick)
	highlight := map[int]bool{}
	for _, p := range pos {
		if p < n {
			highlight[p] = true
		}
	}
	var b strings.Builder
	for i, r := range runes {
		if highlight[i] {
			b.WriteString(chaseStyle.Render(string(r)))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func renderVerticalMenu(width int, opts []string, selected int) string {
	n := len(opts)
	above := selected
	below := n - 1 - selected

	var b strings.Builder
	for pad := below; pad > 0; pad-- {
		b.WriteByte('\n')
	}
	for i := 0; i < above; i++ {
		b.WriteString(dimStyle.Render(" " + opts[i]))
		b.WriteByte('\n')
	}
	b.WriteString(line(width))
	b.WriteByte('\n')
	b.WriteString(selectStyle.Render(" " + opts[selected]))
	b.WriteByte('\n')
	b.WriteString(line(width))
	for i := selected + 1; i < n; i++ {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(" " + opts[i]))
	}
	for pad := above; pad > 0; pad-- {
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	b.WriteString(hintStyle.Render("   ↑↓ 切换   enter 确认"))
	return b.String()
}

func (s footerMenu) render(width, _ int) string {
	labels := make([]string, len(s.options))
	for i, o := range s.options {
		labels[i] = o.Label
	}
	return renderVerticalMenu(width, labels, s.selected)
}

func (s footerStatus) render(width, tick int) string {
	main := " " + renderChase(s.title, tick)
	sub := hintStyle.Render(" " + s.nextHint)
	return wrapBox(width, main, sub)
}

func (s footerInput) render(width, _ int) string {
	display := s.value
	if s.password {
		display = strings.Repeat("●", utf8.RuneCountInString(s.value))
	}
	cursor := ""
	if s.cursor {
		cursor = "▌"
	}
	main := fmt.Sprintf(" %s  ▏ %s%s", titleStyle.Render(s.label), display, cursor)
	sub := hintStyle.Render(" " + s.hint)
	return wrapBox(width, main, sub)
}

func (s footerConfirm) render(width, _ int) string {
	sel := 1
	if s.yesFocus {
		sel = 0
	}
	return renderVerticalMenu(width, []string{"是", "否"}, sel)
}

func renderProgress(label string, done, total int64, width, tick int) string {
	const barWidth = 30
	guide := strings.Repeat(" ", hintGuideStart) + "┌─── "
	head := borderStyle.Render(guide) + hintStyle.Render(label)

	if total <= 0 {
		return fmt.Sprintf("%s  %s  %s", head, renderChase("...", tick), formatBytes(done))
	}
	pct := float64(done) / float64(total)
	if pct < 0 {
		pct = 0
	}
	if pct > 1 {
		pct = 1
	}
	filled := int(float64(barWidth) * pct)
	barStr := strings.Repeat("█", filled) + dimStyle.Render(strings.Repeat("░", barWidth-filled))
	return fmt.Sprintf("%s  %s  %3d%%  %s/%s", head, barStr, int(pct*100), formatBytes(done), formatBytes(total))
}

func formatBytes(n int64) string {
	const (
		kb = 1024
		mb = kb * 1024
		gb = mb * 1024
	)
	switch {
	case n >= gb:
		return fmt.Sprintf("%.1fGB", float64(n)/gb)
	case n >= mb:
		return fmt.Sprintf("%.1fMB", float64(n)/mb)
	case n >= kb:
		return fmt.Sprintf("%.1fKB", float64(n)/kb)
	default:
		return fmt.Sprintf("%dB", n)
	}
}

func (s footerExit) render(width, _ int) string {
	main := selectStyle.Render(" 退出")
	if s.message != "" {
		main = " " + s.message
	}
	sub := hintStyle.Render("   enter 退出")
	return wrapBox(width, main, sub)
}

func (s footerFormConfirm) render(width, _ int) string {
	var b strings.Builder
	b.WriteString(titleStyle.Render(" 请确认配置"))
	b.WriteByte('\n')
	for _, row := range s.rows {
		b.WriteString(dimStyle.Render("   " + row.label + ": "))
		b.WriteString(row.value)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	b.WriteString(renderVerticalMenu(width, []string{"确认", "重填"}, s.selected))
	return b.String()
}

func (s footerForm) render(width, _ int) string {
	var b strings.Builder
	above := s.cur
	below := len(s.fields) - 1 - s.cur
	n := len(s.fields)

	// 第一项时不补空白；进入第二项后才需要 below 行空白维持框位置稳定
	if s.cur > 0 {
		for pad := below; pad > 0; pad-- {
			b.WriteByte('\n')
		}
	}
	for i := 0; i < s.cur; i++ {
		b.WriteString(dimStyle.Render(fmt.Sprintf(" %s: %s", s.fields[i].Label, s.values[i])))
		b.WriteByte('\n')
	}

	// hint 行（始终占 1 行高度，让框位置稳定）
	b.WriteString(renderHintRow(s.hint, width))
	b.WriteByte('\n')

	// 上框线（hint 落点处用 ┴ 接住）
	b.WriteString(topBoxLine(s.hint != "", width))
	b.WriteByte('\n')

	// 当前输入行
	b.WriteString(fmt.Sprintf(" %s: %s", titleStyle.Render(s.fields[s.cur].Label), s.inputView))
	b.WriteByte('\n')

	// 下框线
	b.WriteString(line(width))

	// 未填项
	for i := s.cur + 1; i < n; i++ {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(fmt.Sprintf(" %s: ", s.fields[i].Label)))
	}
	for pad := above; pad > 0; pad-- {
		b.WriteByte('\n')
	}

	// "↑ 上一项" 提示（仅当不是第一项时）
	b.WriteByte('\n')
	if s.cur > 0 {
		b.WriteString(hintStyle.Render("   ↑ 上一项"))
	}
	return b.String()
}

const hintGuideStart = 3

func renderHintRow(hint string, width int) string {
	if hint == "" {
		return ""
	}
	guide := strings.Repeat(" ", hintGuideStart) + "┌─── "
	return borderStyle.Render(guide) + hintStyle.Render(hint)
}

func topBoxLine(hasHint bool, width int) string {
	if !hasHint {
		return line(width)
	}
	// 引导线落点对齐：hintGuideStart 个 ─ + ┴ + 剩余 ─
	left := strings.Repeat("─", hintGuideStart)
	rest := width - hintGuideStart - 1
	if rest < 0 {
		rest = 0
	}
	return borderStyle.Render(left + "┴" + strings.Repeat("─", rest))
}

func renderHintLine(left, hint string, width int) string {
	if hint == "" {
		return dimStyle.Render(left)
	}
	hintRendered := hintStyle.Render(hint)
	if left == "" {
		pad := width - visualWidth(hint)
		if pad < 1 {
			return hintRendered
		}
		return strings.Repeat(" ", pad) + hintRendered
	}
	pad := width - visualWidth(left) - visualWidth(hint)
	if pad < 2 {
		pad = 2
	}
	return dimStyle.Render(left) + strings.Repeat(" ", pad) + hintRendered
}

func visualWidth(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			n += 2
			continue
		}
		n++
	}
	return n
}
