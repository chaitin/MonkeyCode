package kb

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestDirectCreationRejectsFileAndURLBeforeWriting(t *testing.T) {
	s := &Service{}
	for _, source := range []string{"file", "url"} {
		for _, personal := range []bool{false, true} {
			_, err := s.createDocument(t.Context(), "actor", DocumentInput{KbID: "kb", Title: "unsupported", SourceType: source, Content: "body"}, personal)
			if err == nil || resource.AsError(err).Status != 400 {
				t.Fatalf("source=%s personal=%v: %v", source, personal, err)
			}
		}
	}
}
