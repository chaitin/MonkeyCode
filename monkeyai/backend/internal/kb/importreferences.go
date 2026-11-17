package kb

import (
	"regexp"
	"slices"
	"strings"
)

// Match complete link destinations, never substrings of an external URL.
// Only the captured destination is replaced, preserving the rest of the source.
var importInlineLink = regexp.MustCompile(`!?\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]\([ \t\r\n]*(?:<([^<>\r\n]*)>|([^\s()<>]+))(?:[ \t\r\n]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t\r\n]*\)`)
var importReferenceDefinition = regexp.MustCompile(`(?m)^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^<>\r\n]*)>|([^\s<>]+))`)
var importHTMLImage = regexp.MustCompile(`(?i)<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>`)
var importHTMLAttribute = regexp.MustCompile(`([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?`)
var importHTMLComment = regexp.MustCompile(`(?s)<!--.*?(?:-->|$)`)

type importAssetReference struct {
	start, end int
	name       string
}

func importEscaped(content string, offset int) bool {
	count := 0
	for offset > 0 && content[offset-1] == '\\' {
		count++
		offset--
	}
	return count%2 != 0
}

// Hide code and comments while keeping byte offsets into the original source.
func importLinkSource(content string) string {
	source := []byte(content)
	hide := func(start, end int) {
		for i := start; i < end; i++ {
			if source[i] != '\n' && source[i] != '\r' {
				source[i] = ' '
			}
		}
	}
	var fence byte
	fenceLength := 0
	for start := 0; start < len(content); {
		end := strings.IndexByte(content[start:], '\n')
		if end < 0 {
			end = len(content)
		} else {
			end += start + 1
		}
		line := strings.TrimRight(content[start:end], "\r\n")
		trimmed := strings.TrimLeft(line, " ")
		indent := len(line) - len(trimmed)
		// Fenced blocks can also appear inside Markdown blockquotes.
		for indent <= 3 && strings.HasPrefix(trimmed, ">") {
			line = strings.TrimPrefix(trimmed[1:], " ")
			trimmed = strings.TrimLeft(line, " ")
			indent = len(line) - len(trimmed)
		}
		run := 0
		if indent <= 3 && len(trimmed) > 0 && (trimmed[0] == '`' || trimmed[0] == '~') {
			for run < len(trimmed) && trimmed[run] == trimmed[0] {
				run++
			}
		}
		if fence != 0 {
			hide(start, end)
			if run >= fenceLength && trimmed[0] == fence && strings.TrimSpace(trimmed[run:]) == "" {
				fence = 0
			}
		} else if run >= 3 && (trimmed[0] != '`' || !strings.Contains(trimmed[run:], "`")) {
			fence, fenceLength = trimmed[0], run
			hide(start, end)
		} else if indent >= 4 || strings.HasPrefix(line, "\t") {
			hide(start, end)
		}
		start = end
	}
	for _, span := range importHTMLComment.FindAllIndex(source, -1) {
		hide(span[0], span[1])
	}
	for start := 0; start < len(source); {
		if source[start] != '`' || importEscaped(content, start) {
			start++
			continue
		}
		end := start + 1
		for end < len(source) && source[end] == '`' {
			end++
		}
		length := end - start
		closed := false
		for next := end; next < len(source); {
			if source[next] != '`' {
				next++
				continue
			}
			stop := next + 1
			for stop < len(source) && source[stop] == '`' {
				stop++
			}
			if stop-next == length {
				hide(start, stop)
				start, closed = stop, true
				break
			}
			next = stop
		}
		if !closed {
			start = end
		}
	}
	return string(source)
}

func importAssetReferences(content string) []importAssetReference {
	source := importLinkSource(content)
	tags := importHTMLImage.FindAllStringIndex(source, -1)
	inlineSource := []byte(source)
	for _, tag := range tags {
		// Markdown syntax inside HTML attributes is literal text.
		for i := tag[0]; i < tag[1]; i++ {
			inlineSource[i] = ' '
		}
	}
	var refs []importAssetReference
	add := func(start, end int) {
		target := content[start:end]
		if strings.HasPrefix(target, "../assets/") {
			refs = append(refs, importAssetReference{start, end, strings.TrimPrefix(target, "../assets/")})
		}
	}
	for _, pattern := range []*regexp.Regexp{importInlineLink, importReferenceDefinition} {
		for _, match := range pattern.FindAllSubmatchIndex(inlineSource, -1) {
			if importEscaped(content, match[0]) {
				continue
			}
			for group := 2; group < len(match); group += 2 {
				if match[group] >= 0 {
					add(match[group], match[group+1])
				}
			}
		}
	}
	for _, tag := range tags {
		start := tag[0] + len("<img")
		for _, attr := range importHTMLAttribute.FindAllStringSubmatchIndex(source[start:tag[1]-1], -1) {
			if !strings.EqualFold(source[start+attr[2]:start+attr[3]], "src") {
				continue
			}
			for group := 4; group < len(attr); group += 2 {
				if attr[group] >= 0 {
					add(start+attr[group], start+attr[group+1])
				}
			}
		}
	}
	slices.SortFunc(refs, func(a, b importAssetReference) int { return a.start - b.start })
	return slices.CompactFunc(refs, func(a, b importAssetReference) bool { return a.start == b.start && a.end == b.end })
}

func rewriteImportAssetReferences(content string, target func(string) string) string {
	refs := importAssetReferences(content)
	if len(refs) == 0 {
		return content
	}
	var out strings.Builder
	end := 0
	for _, ref := range refs {
		if ref.start < end {
			continue
		}
		out.WriteString(content[end:ref.start])
		out.WriteString(target(ref.name))
		end = ref.end
	}
	out.WriteString(content[end:])
	return out.String()
}
