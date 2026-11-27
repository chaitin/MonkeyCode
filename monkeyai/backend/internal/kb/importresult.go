package kb

import (
	"context"
	"errors"
	"io"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
	"golang.org/x/net/html"
)

// A successful anydoc task is not proof that its image uploads succeeded.
func (s *Service) validateConvertedAssets(ctx context.Context, kbID, content string) error {
	source := []byte(content)
	checkImage := func(dest string) error {
		prefix := "/api/kb/" + kbID + "/assets/"
		if !strings.HasPrefix(dest, prefix) {
			return errors.New("转换结果图片未成功保存到知识库")
		}
		name := strings.TrimPrefix(dest, prefix)
		if !assetName.MatchString(name) {
			return errors.New("转换结果图片地址无效")
		}
		if _, _, e := s.readAsset(ctx, kbID, name); e != nil {
			return errors.New("转换结果图片不存在或无法读取")
		}
		return nil
	}
	checkHTML := func(fragment string) error {
		z := html.NewTokenizer(strings.NewReader(fragment))
		for {
			kind := z.Next()
			if kind == html.ErrorToken {
				if z.Err() == io.EOF {
					return nil
				}
				return z.Err()
			}
			if kind != html.StartTagToken && kind != html.SelfClosingTagToken {
				continue
			}
			token := z.Token()
			switch token.Data {
			case "script", "iframe", "object", "embed", "link", "meta", "base", "style", "svg", "math", "audio", "video", "source", "form", "input":
				return errors.New("转换结果包含不安全的 HTML 内容")
			}
			for _, a := range token.Attr {
				if strings.HasPrefix(a.Key, "on") || a.Key == "srcdoc" || a.Key == "srcset" || a.Key == "style" || a.Key == "background" {
					return errors.New("转换结果包含不安全的 HTML 属性")
				}
				if a.Key == "src" {
					if token.Data != "img" {
						return errors.New("转换结果包含未验证的资源")
					}
					if e := checkImage(a.Val); e != nil {
						return e
					}
				}
				if a.Key == "href" || a.Key == "xlink:href" {
					v := strings.ToLower(strings.TrimSpace(a.Val))
					if strings.HasPrefix(v, "javascript:") || strings.HasPrefix(v, "data:") {
						return errors.New("转换结果包含不安全的链接")
					}
				}
			}
		}
	}
	root := goldmark.DefaultParser().Parse(text.NewReader(source))
	return ast.Walk(root, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var e error
		switch n := n.(type) {
		case *ast.RawHTML:
			var b strings.Builder
			for i := 0; i < n.Segments.Len(); i++ {
				seg := n.Segments.At(i)
				b.Write(seg.Value(source))
			}
			e = checkHTML(b.String())
		case *ast.HTMLBlock:
			var b strings.Builder
			for i := 0; i < n.Lines().Len(); i++ {
				seg := n.Lines().At(i)
				b.Write(seg.Value(source))
			}
			e = checkHTML(b.String())
		case *ast.Image:
			e = checkImage(string(util.UnescapePunctuations(n.Destination)))
		}
		if e != nil {
			return ast.WalkStop, e
		}
		return ast.WalkContinue, nil
	})
}
