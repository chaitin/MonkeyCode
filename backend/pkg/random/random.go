package random

import (
	"crypto/rand"
	"encoding/hex"
)

// String 生成指定长度的随机字符串
func String(n int) string {
	b := make([]byte, (n+1)/2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)[:n]
}
