package deploy

import "strings"

func MergeEnv(oldEnv, newTemplate string, forceNew map[string]bool) string {
	oldValues := parseEnvLines(oldEnv)
	var out []string
	seen := map[string]bool{}

	for _, line := range strings.Split(newTemplate, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			out = append(out, line)
			continue
		}

		key = strings.TrimSpace(key)
		seen[key] = true
		if !forceNew[key] {
			if old, exists := oldValues[key]; exists {
				value = old
			}
		}
		out = append(out, key+"="+value)
	}

	for key, value := range oldValues {
		if !seen[key] {
			out = append(out, key+"="+value)
		}
	}
	return strings.Join(out, "\n") + "\n"
}

func parseEnvLines(content string) map[string]string {
	values := map[string]string{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = value
	}
	return values
}
