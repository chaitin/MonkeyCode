package kb

import (
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
	"strings"
)

// Keep Markdown top-level headings, paragraphs, lists and tables together where
// possible. Oversized blocks retain the existing bounded overlapping fallback.
func splitMarkdown(content string) []string {
	source := []byte(content)
	root := goldmark.New(goldmark.WithExtensions(extension.Table)).Parser().Parse(text.NewReader(source))
	boundaries := []int{0}
	for n := root.FirstChild(); n != nil; n = n.NextSibling() {
		if lines := n.Lines(); lines.Len() > 0 {
			start := lines.At(0).Start
			// AST line offsets can start after a heading/list marker. Use line start.
			for start > 0 && source[start-1] != '\n' {
				start--
			}
			if start > boundaries[len(boundaries)-1] {
				boundaries = append(boundaries, start)
			}
		}
	}
	boundaries = append(boundaries, len(source))
	result := []string{}
	pending := ""
	flush := func() {
		if strings.TrimSpace(pending) != "" {
			result = append(result, strings.TrimSpace(pending))
		}
		pending = ""
	}
	for i := 0; i+1 < len(boundaries); i++ {
		block := string(source[boundaries[i]:boundaries[i+1]])
		if len([]rune(block)) > chunkRunes {
			flush()
			result = append(result, splitContent(block)...)
			continue
		}
		if len([]rune(pending+block)) > chunkRunes {
			flush()
		}
		pending += block
	}
	flush()
	return result
}
