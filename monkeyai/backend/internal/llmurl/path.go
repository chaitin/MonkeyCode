package llmurl

import "path"

func JoinPath(basePath, endpoint string, anthropic bool) string {
	if anthropic && path.Base(path.Clean(basePath)) != "v1" {
		basePath = path.Join(basePath, "/v1")
	}
	return path.Join(basePath, endpoint)
}
