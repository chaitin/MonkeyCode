package proxy

import (
	"strconv"
	"strings"
)

func negotiateEncoding(values []string) (string, bool) {
	if len(values) == 0 {
		return "", true
	}
	qualities := make(map[string]float64)
	for _, value := range values {
		for item := range strings.SplitSeq(value, ",") {
			parts := strings.Split(item, ";")
			coding := strings.ToLower(strings.TrimSpace(parts[0]))
			switch coding {
			case "gzip", "identity", "*":
			default:
				continue
			}
			quality := 1.0
			for i, parameter := range parts[1:] {
				name, weight, ok := strings.Cut(parameter, "=")
				if !ok || i > 0 || !strings.EqualFold(strings.TrimSpace(name), "q") {
					quality = 0
					break
				}
				q, err := strconv.ParseFloat(strings.TrimSpace(weight), 64)
				if err != nil || !(q >= 0 && q <= 1) {
					quality = 0
					break
				}
				quality = q
			}
			if previous, ok := qualities[coding]; ok {
				quality = min(quality, previous)
			}
			qualities[coding] = quality
		}
	}
	gzip, ok := qualities["gzip"]
	if !ok {
		gzip = qualities["*"]
	}
	identity, explicitIdentity := qualities["identity"]
	if !explicitIdentity {
		identity = 1
		if wildcard, ok := qualities["*"]; ok && wildcard == 0 {
			identity = 0
		}
	}
	// 未显式指定 identity 权重时，将明文作为 gzip 不可用时的回退。
	if gzip > 0 && (!explicitIdentity || gzip >= identity) {
		if identity == 0 {
			return "gzip, identity;q=0", true
		}
		return "gzip", true
	}
	if identity > 0 {
		return "identity", true
	}
	return "", false
}
