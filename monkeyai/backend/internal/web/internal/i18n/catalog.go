package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

//go:embed messages.json additional.json details.tsv
var texts embed.FS

type messageTemplate struct {
	source  *regexp.Regexp
	format  string
	wrapped []bool
}

type catalog struct {
	codes     map[string]map[string]string
	details   map[string]string
	english   map[string]bool
	templates []messageTemplate
}

var translations = readCatalog()
var messages = translations.codes
var formatToken = regexp.MustCompile(`%[sdvqw]`)

func readCatalog() catalog {
	out := catalog{codes: map[string]map[string]string{}, details: map[string]string{}, english: map[string]bool{}}
	for _, file := range []string{"messages.json", "additional.json"} {
		data, err := texts.ReadFile(file)
		if err != nil {
			panic(err)
		}
		var values map[string]map[string]string
		if err := json.Unmarshal(data, &values); err != nil {
			panic(err)
		}
		for code, value := range values {
			if _, exists := out.codes[code]; exists || value["zh-CN"] == "" || value["en-US"] == "" {
				panic("错误码重复或缺少翻译: " + code)
			}
			out.codes[code] = value
			out.english[value["en-US"]] = true
		}
	}
	data, err := texts.ReadFile("details.tsv")
	if err != nil {
		panic(err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		source, target, ok := strings.Cut(line, "\t")
		if !ok || source == "" || target == "" || out.details[source] != "" {
			panic("错误文案重复或缺少翻译: " + source)
		}
		out.details[source] = target
		out.english[target] = true
	}
	// 具体模板优先于包装模板，避免把已知原因折叠成通用错误。
	keys := make([]string, 0, len(out.details))
	for source := range out.details {
		keys = append(keys, source)
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
	for _, source := range keys {
		if !strings.Contains(source, "%") {
			continue
		}
		target := out.details[source]
		if len(formatToken.FindAllString(source, -1)) != len(formatToken.FindAllString(target, -1)) {
			panic("翻译模板参数不一致: " + source)
		}
		var wrapped []bool
		for _, token := range formatToken.FindAllString(source, -1) {
			wrapped = append(wrapped, token == "%w")
		}
		out.templates = append(out.templates, messageTemplate{source: templatePattern(source), format: formatToken.ReplaceAllString(target, "%s"), wrapped: wrapped})
	}
	return out
}

func HasCode(code string) bool { return messages[code] != nil }

func templatePattern(value string) *regexp.Regexp {
	var expression strings.Builder
	expression.WriteString("^")
	last := 0
	for _, position := range formatToken.FindAllStringIndex(value, -1) {
		expression.WriteString(regexp.QuoteMeta(value[last:position[0]]))
		if value[position[0]:position[1]] == "%d" {
			expression.WriteString(`(-?\d+)`)
		} else {
			expression.WriteString(`([^\r\n]*?)`)
		}
		last = position[1]
	}
	expression.WriteString(regexp.QuoteMeta(value[last:]))
	expression.WriteString("$")
	return regexp.MustCompile(expression.String())
}

func localized(locale, code, fallback string, depth int) string {
	if locale == "zh-CN" {
		if fallback != "" && strings.ContainsFunc(fallback, func(r rune) bool { return unicode.Is(unicode.Han, r) }) {
			return fallback
		}
		if text := messages[code][locale]; text != "" {
			return text
		}
		return messages["request_failed"][locale]
	}
	if text := translations.details[fallback]; text != "" {
		return text
	}
	if translations.english[fallback] {
		return fallback
	}
	if depth < 3 {
		for _, template := range translations.templates {
			if matches := template.source.FindStringSubmatch(fallback); matches != nil {
				args := make([]any, len(matches)-1)
				for i, value := range matches[1:] {
					if template.wrapped[i] {
						value = strings.TrimSuffix(localized(locale, code, value, depth+1), ".")
					}
					args[i] = value
				}
				return fmt.Sprintf(template.format, args...)
			}
		}
	}
	if text := messages[code][locale]; text != "" {
		return text
	}
	return messages["request_failed"][locale]
}
