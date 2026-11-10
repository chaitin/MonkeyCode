package kb

import (
	"strings"
	"testing"
)

func TestSplitContentUsesBoundedOverlappingChunks(t *testing.T) {
	content := strings.Repeat("知", chunkRunes*2+600)
	chunks := splitContent(content)
	if len(chunks) != 3 {
		t.Fatalf("分片数量 = %d，预期 3", len(chunks))
	}
	for i, chunk := range chunks {
		if size := len([]rune(chunk)); size == 0 || size > chunkRunes {
			t.Fatalf("第 %d 个分片长度无效: %d", i, size)
		}
	}
	if tail := []rune(chunks[0])[chunkRunes-overlapRunes:]; string(tail) != string([]rune(chunks[1])[:overlapRunes]) {
		t.Fatal("相邻分片未保留约定重叠")
	}
}

func TestSplitContentIgnoresBlankInput(t *testing.T) {
	if chunks := splitContent(" \n\t "); len(chunks) != 0 {
		t.Fatalf("空白内容产生分片: %#v", chunks)
	}
}

func TestFormatVectorRejectsInvalidValues(t *testing.T) {
	if _, err := formatVector(nil); err == nil {
		t.Fatal("空向量应失败")
	}
	if got, err := formatVector([]float64{0.1, -2, 3.25}); err != nil || got != "[0.1,-2,3.25]" {
		t.Fatalf("格式化向量 = %q, %v", got, err)
	}
	if _, err := formatVector([]float64{1, 0}); err != nil {
		t.Fatalf("有效向量被拒绝: %v", err)
	}
}
