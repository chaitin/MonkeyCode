package deploy

import (
	"strings"
	"testing"
)

func TestMergeEnvKeepsSecretsAndUpdatesImages(t *testing.T) {
	oldEnv := "POSTGRES_PASSWORD=old-secret\nBACKEND_IMAGE=backend:old\nREMOTE_IP=10.0.0.1\n"
	newTemplate := "POSTGRES_PASSWORD=\nBACKEND_IMAGE=backend:new\nFRONTEND_IMAGE=frontend:new\nREMOTE_IP=\nNEW_FLAG=true\n"
	got := MergeEnv(oldEnv, newTemplate, map[string]bool{
		"BACKEND_IMAGE":  true,
		"FRONTEND_IMAGE": true,
	})

	for _, want := range []string{
		"POSTGRES_PASSWORD=old-secret",
		"BACKEND_IMAGE=backend:new",
		"FRONTEND_IMAGE=frontend:new",
		"REMOTE_IP=10.0.0.1",
		"NEW_FLAG=true",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("merged env missing %q:\n%s", want, got)
		}
	}
}
