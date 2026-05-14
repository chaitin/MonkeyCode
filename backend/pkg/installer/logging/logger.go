package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type Logger struct {
	file *os.File
	path string
}

func New() (*Logger, error) {
	name := fmt.Sprintf("installer-%s.log", time.Now().Format("20060102-150405"))
	path := filepath.Join(os.TempDir(), name)
	f, err := os.Create(path)
	if err != nil {
		return nil, fmt.Errorf("创建日志文件失败: %w", err)
	}
	return &Logger{file: f, path: path}, nil
}

func (l *Logger) Path() string     { return l.path }
func (l *Logger) Plain() io.Writer { return l.file }
func (l *Logger) Sync() error      { return l.file.Sync() }
func (l *Logger) Close() error     { return l.file.Close() }
