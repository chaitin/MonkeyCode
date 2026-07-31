package taskflow

import (
	"errors"
	"fmt"
	"testing"
)

func TestIsVirtualMachineNotFound(t *testing.T) {
	notFound := errors.New("recv err failed to stop environment: environment not found: env-1")
	if !IsVirtualMachineNotFound(fmt.Errorf("delete vm: %w", notFound)) {
		t.Fatal("wrapped environment-not-found error must be recognized")
	}
	if IsVirtualMachineNotFound(errors.New("failed to stop environment: connection refused")) {
		t.Fatal("unrelated delete error must remain a failure")
	}
	if IsVirtualMachineNotFound(nil) {
		t.Fatal("nil must not be recognized as not found")
	}
}
