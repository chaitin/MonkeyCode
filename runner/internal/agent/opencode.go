package agent

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type OpenCodeAgent struct {
	logger *slog.Logger
}

func NewOpenCodeAgent(logger *slog.Logger) *OpenCodeAgent {
	return &OpenCodeAgent{logger: logger}
}

type ExecuteOptions struct {
	TaskID  string
	WorkDir string
	Text    string
	Model   string
	APIKey  string
	BaseURL string
	EnvVars map[string]string
	Timeout time.Duration
}

type ExecuteResult struct {
	Output   string
	Error    string
	ExitCode int
	Duration time.Duration
}

type ProgressCallback func(source string, data []byte)

func (a *OpenCodeAgent) Execute(ctx context.Context, opts ExecuteOptions, progressCb ProgressCallback) (*ExecuteResult, error) {
	startTime := time.Now()

	if opts.WorkDir == "" {
		return nil, fmt.Errorf("work directory is required")
	}

	if opts.Text == "" {
		return nil, fmt.Errorf("text is required")
	}

	if opts.Timeout == 0 {
		opts.Timeout = 30 * time.Minute
	}

	ctx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	args := a.buildArgs(opts)

	cmd := exec.CommandContext(ctx, "opencode", args...)
	cmd.Dir = opts.WorkDir

	env := os.Environ()
	for k, v := range opts.EnvVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	if opts.APIKey != "" {
		env = append(env, fmt.Sprintf("OPENAI_API_KEY=%s", opts.APIKey))
	}
	if opts.BaseURL != "" {
		env = append(env, fmt.Sprintf("OPENAI_BASE_URL=%s", opts.BaseURL))
	}
	cmd.Env = env

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start opencode: %w", err)
	}

	var outputBuilder, errorBuilder strings.Builder
	var mu sync.Mutex

	go a.readStream(stdout, "stdout", &outputBuilder, &mu, progressCb)
	go a.readStream(stderr, "stderr", &errorBuilder, &mu, progressCb)

	err = cmd.Wait()

	result := &ExecuteResult{
		Output:   outputBuilder.String(),
		Error:    errorBuilder.String(),
		Duration: time.Since(startTime),
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
		if ctx.Err() == context.DeadlineExceeded {
			result.Error = "task timeout"
		}
		return result, fmt.Errorf("command failed: %w", err)
	}

	result.ExitCode = 0
	return result, nil
}

func (a *OpenCodeAgent) buildArgs(opts ExecuteOptions) []string {
	args := []string{"run"}

	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}

	args = append(args, opts.Text)

	return args
}

func (a *OpenCodeAgent) readStream(reader io.Reader, source string, builder *strings.Builder, mu *sync.Mutex, cb ProgressCallback) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Bytes()
		lineCopy := make([]byte, len(line))
		copy(lineCopy, line)

		mu.Lock()
		builder.Write(lineCopy)
		builder.WriteByte('\n')
		mu.Unlock()

		if cb != nil {
			cb(source, lineCopy)
		}
	}
}

func (a *OpenCodeAgent) IsAvailable() bool {
	_, err := exec.LookPath("opencode")
	return err == nil
}

func (a *OpenCodeAgent) Version() (string, error) {
	cmd := exec.Command("opencode", "--version")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func (a *OpenCodeAgent) PrepareWorkspace(ctx context.Context, workDir, gitURL, gitToken string) error {
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return fmt.Errorf("failed to create workspace: %w", err)
	}

	if gitURL != "" {
		cloneURL := gitURL
		if gitToken != "" && strings.HasPrefix(gitURL, "https://") {
			cloneURL = strings.Replace(gitURL, "https://", fmt.Sprintf("https://%s@", gitToken), 1)
		}

		repoName := filepath.Base(gitURL)
		repoName = strings.TrimSuffix(repoName, ".git")

		cmd := exec.CommandContext(ctx, "git", "clone", cloneURL, repoName)
		cmd.Dir = workDir
		cmd.Env = os.Environ()

		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to clone repository: %w, output: %s", err, string(output))
		}

		a.logger.Info("repository cloned", "repo", repoName, "dir", workDir)
	}

	return nil
}
