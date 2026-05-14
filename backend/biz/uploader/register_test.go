package uploader

import (
	"testing"

	"github.com/samber/do"
)

func TestProvideUploader(t *testing.T) {
	i := do.New()
	ProvideUploader(i)
}
