package kb

import (
	"bytes"
	"fmt"
	"runtime"
	"strings"
	"testing"
)

func TestImportAssetDestinations(t *testing.T) {
	image := avatarImage(t, "png")
	name := strings.TrimPrefix(importHash(image), "sha256:") + ".png"
	local := "../assets/" + name
	url := assetURL("library", name)
	for _, tc := range []struct {
		name, content, want string
	}{
		{"inline", "![说明](" + local + ")", "![说明](" + url + ")"},
		{"angle and title", "![说明](<" + local + "> \"标题\")", "![说明](<" + url + "> \"标题\")"},
		{"nested label", "![[说明]](" + local + ")", "![[说明]](" + url + ")"},
		{"reference", "![说明][image]\n\n[image]: " + local + " '标题'", "![说明][image]\n\n[image]: " + url + " '标题'"},
		{"HTML", "<img alt='说明' src='" + local + "'>", "<img alt='说明' src='" + url + "'>"},
		{"unquoted HTML", "<IMG SRC=" + local + ">", "<IMG SRC=" + url + ">"},
		{"quoted HTML delimiter", "<img alt='>' src='" + local + "'>", "<img alt='>' src='" + url + "'>"},
		{"literal HTML attribute", `<img alt=" src='../assets/missing.png' ![example](../assets/missing.png)" src='` + local + "'>", `<img alt=" src='../assets/missing.png' ![example](../assets/missing.png)" src='` + url + "'>"},
		{"ordinary text", "图片目录示例 ../assets/logo.png", ""},
		{"inline code", "`../assets/logo.png` and `![example](" + local + ")`", ""},
		{"multiple backticks", "`` `![example](" + local + ")` ``", ""},
		{"fenced code", "```markdown\n![example](../assets/missing.png)\n```", ""},
		{"tilde fence", "~~~~markdown\n![example](../assets/missing.png)\n~~~~", ""},
		{"quoted fence", "> ~~~markdown\n> ![example](../assets/missing.png)\n> ~~~", ""},
		{"indented code", "    ![example](../assets/missing.png)", ""},
		{"comment", "<!-- ![example](../assets/missing.png) -->", ""},
		{"escaped bracket", `\[example](` + local + ")", ""},
		{"external image", "![说明](https://example.org/docs/../assets/" + name + ")", ""},
		{"external link", "[说明](https://example.org/docs/../assets/" + name + ")", ""},
		{"external HTML", "<img src='https://example.org/docs/../assets/" + name + "'>", ""},
		{"unclosed link", "![example](../assets/missing.png", ""},
		{"mixed", "`../assets/missing.png`\n![说明](" + local + ")", "`../assets/missing.png`\n![说明](" + url + ")"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := importFixture(t, func(f map[string][]byte) {
				f["knowledge/manual/doc.md"] = []byte(tc.content)
				f["knowledge/manual/assets/"+name] = image
			})
			p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
			if err != nil {
				t.Fatal(err)
			}
			want := tc.want
			if want == "" {
				want = tc.content
			}
			if got := p.Books[0].RewriteAssets(tc.content, "library"); got != want {
				t.Fatalf("rewrite:\n got %q\nwant %q", got, want)
			}
		})
	}
}

func TestImportMissingImageDestinations(t *testing.T) {
	for _, content := range []string{
		"![missing](../assets/missing.png)",
		"![missing](<../assets/missing.png> \"title\")",
		"![missing][image]\n\n[image]: ../assets/missing.png",
		"<img src='../assets/missing.png'>",
	} {
		raw := importFixture(t, func(f map[string][]byte) {
			f["knowledge/manual/doc.md"] = []byte(content)
		})
		if _, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw))); err == nil {
			t.Fatalf("accepted missing image: %q", content)
		}
	}
}

func TestImportImagesStayInZIP(t *testing.T) {
	image := avatarImage(t, "png")
	raw := importFixture(t, func(f map[string][]byte) {
		for i := 0; i < 16; i++ {
			data := make([]byte, 2<<20)
			copy(data, image)
			copy(data[len(data)-32:], fmt.Sprintf("%032d", i))
			name := strings.TrimPrefix(importHash(data), "sha256:") + ".png"
			f["knowledge/manual/assets/"+name] = data
		}
	})
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	runtime.GC()
	runtime.ReadMemStats(&after)
	// The old implementation retained all 32 MiB of image bytes here.
	if after.HeapAlloc > before.HeapAlloc+8<<20 {
		t.Fatalf("parsing retained %d extra bytes for ZIP size %d", after.HeapAlloc-before.HeapAlloc, len(raw))
	}
	if len(p.Books[0].Assets) != 16 {
		t.Fatal("missing image metadata")
	}
	for _, asset := range p.Books[0].Assets {
		data, err := p.assetData(asset)
		if err != nil || len(data) != 2<<20 {
			t.Fatalf("read image: %d bytes, %v", len(data), err)
		}
		asset.sha256 = "sha256:changed"
		if _, err := p.assetData(asset); err == nil {
			t.Fatal("upload accepted changed image bytes")
		}
		break
	}
	runtime.KeepAlive(p)
}
