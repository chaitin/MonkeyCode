// Package hostname validates names stored in hosts.name, independently of raw engine reports.
package hostname

import "strings"

// Match ECMAScript String.trim(), including BOM but excluding NEL.
const whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

func Normalize(raw string) (string, bool) {
	name := strings.Trim(raw, whitespace)
	return name, len(name) <= 128 && !strings.ContainsAny(name, "\r\n\x00")
}

// Candidate ignores unusable names without discarding an otherwise valid heartbeat.
func Candidate(raw string) string {
	if name, ok := Normalize(raw); ok {
		return name
	}
	return ""
}
