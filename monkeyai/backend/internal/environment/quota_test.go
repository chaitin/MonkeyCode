package environment

import (
	"testing"
)

func TestResourcesWithoutDiskConfiguration(t *testing.T) {
	s, user, _ := fixture(t)
	if _, err := s.Create(t.Context(), user, Creation{testSpecification(), "directory", "no-disk"}); err != nil {
		t.Fatal(err)
	}
}
