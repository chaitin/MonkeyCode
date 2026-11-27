package kb

import (
	"fmt"
	"slices"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

type imageSpan struct{ start, labelEnd, end int }

// Track the source spans consumed by the CommonMark link parser. Rewriting an
// image at its use site leaves shared reference definitions and plain text intact.
type importImageParser struct {
	parser.InlineParser
	labels map[ast.Node]int
	images map[*ast.Image]imageSpan
}

func (p *importImageParser) Parse(parent ast.Node, reader text.Reader, ctx parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	start := -1
	if line[0] == ']' {
		for node := parent.LastChild(); node != nil; node = node.PreviousSibling() {
			if pos, ok := p.labels[node]; ok {
				start = pos
				break
			}
		}
	}
	node := p.InlineParser.Parse(parent, reader, ctx)
	if node != nil && (line[0] == '!' || line[0] == '[') {
		p.labels[node] = segment.Start
	}
	if image, ok := node.(*ast.Image); ok && start >= 0 {
		_, end := reader.Position()
		p.images[image] = imageSpan{start: start, labelEnd: segment.Start + 1, end: end.Start}
	}
	return node
}

func (p *importImageParser) CloseBlock(parent ast.Node, reader text.Reader, ctx parser.Context) {
	p.InlineParser.(parser.CloseBlocker).CloseBlock(parent, reader, ctx)
	clear(p.labels)
}

// importImageContent validates and optionally rewrites only actual Markdown
// image nodes, skipping code, escaped image syntax and non-image links.
func (b ImportBook) importImageContent(content, id string) (string, error) {
	source := []byte(content)
	tracker := &importImageParser{InlineParser: parser.NewLinkParser(), labels: map[ast.Node]int{}, images: map[*ast.Image]imageSpan{}}
	inline := parser.DefaultInlineParsers()
	for i, entry := range inline {
		if entry.Value == parser.NewLinkParser() {
			inline[i].Value = tracker
		}
	}
	md := goldmark.New(goldmark.WithExtensions(extension.Table), goldmark.WithParser(parser.NewParser(
		parser.WithBlockParsers(parser.DefaultBlockParsers()...),
		parser.WithInlineParsers(inline...),
		parser.WithParagraphTransformers(parser.DefaultParagraphTransformers()...),
	)))
	root := md.Parser().Parse(text.NewReader(source))
	type edit struct {
		imageSpan
		value string
	}
	edits := []edit{}
	err := ast.Walk(root, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		image, ok := node.(*ast.Image)
		if !entering || !ok {
			return ast.WalkContinue, nil
		}
		destination := string(util.UnescapePunctuations(image.Destination))
		if !strings.HasPrefix(destination, "../assets/") {
			return ast.WalkContinue, nil
		}
		name := strings.TrimPrefix(destination, "../assets/")
		if _, ok := b.Assets[name]; !ok {
			return ast.WalkStop, fmt.Errorf("正文引用的图片缺失: %s", destination)
		}
		if id == "" {
			return ast.WalkContinue, nil
		}
		span, ok := tracker.images[image]
		if !ok {
			return ast.WalkStop, fmt.Errorf("无法定位图片引用: %s", destination)
		}
		title := ""
		if len(image.Title) > 0 {
			title = ` "` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(string(image.Title)) + `"`
		}
		value := string(source[span.start:span.labelEnd]) + "(" + assetURL(id, name) + title + ")"
		edits = append(edits, edit{span, value})
		return ast.WalkSkipChildren, nil
	})
	if err != nil {
		return "", err
	}
	// Preserve HTML image support alongside CommonMark image parsing.
	htmlSource := importLinkSource(content)
	tags := importHTMLImage.FindAllStringIndex(htmlSource, -1)
	for _, ref := range importAssetReferences(content) {
		for _, tag := range tags {
			if ref.start < tag[0] || ref.end > tag[1] {
				continue
			}
			if _, ok := b.Assets[ref.name]; !ok {
				return "", fmt.Errorf("正文引用的图片缺失: ../assets/%s", ref.name)
			}
			if id != "" {
				edits = append(edits, edit{imageSpan{start: ref.start, end: ref.end}, assetURL(id, ref.name)})
			}
			break
		}
	}
	slices.SortFunc(edits, func(a, b edit) int { return b.start - a.start })
	for _, edit := range edits {
		content = content[:edit.start] + edit.value + content[edit.end:]
	}
	return content, nil
}
