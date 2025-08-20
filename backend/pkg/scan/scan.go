package scan

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
)

func Scan(id string, workspace, rule string) (*Result, error) {
	if _, err := os.Stat(workspace); err != nil {
		return nil, fmt.Errorf("failed to stat workspace: %w", err)
	}
	output := fmt.Sprintf("/tmp/%s.json", id)
	cmd := exec.Command(
		"/app/assets/sgp/sgp",
		"--metrics=off",
		"--disable-version-check",
		"--disable-nosem",
		"--confidence=HIGH",
		"--confidence=MEDIUM",
		"--impact=HIGH",
		"--impact=MEDIUM",
		"--time",
		"--json",
		"--output", output,
		"--config", rule,
		workspace,
	)
	defer os.Remove(output)

	log.Printf("[Scan] Executing command: %s %s", cmd.Path, strings.Join(cmd.Args[1:], " "))

	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to run command: %w out: %s", err, string(out))
	}

	b, err := os.ReadFile(output)
	if err != nil {
		return nil, fmt.Errorf("failed to read output file: %w", err)
	}

	var r Result
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	r.ID = id
	r.Output = string(out)

	return &r, nil
}
