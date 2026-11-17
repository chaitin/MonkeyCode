package kb

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestValidateDescriptionUpdate(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input resource.Object
		want  string
	}{
		{"omitted", resource.Object{"name": "Renamed"}, "Existing description"},
		{"empty", resource.Object{"description": ""}, ""},
		{"whitespace", resource.Object{"description": " \t\n"}, ""},
		{"replacement", resource.Object{"description": "New description"}, "New description"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old := resource.Object{"id": "existing", "description": "Existing description"}
			service := &Service{}
			if err := service.validate(t.Context(), nil, tc.input, old); err != nil {
				t.Fatal(err)
			}
			if got := tc.input.String("description"); got != tc.want {
				t.Fatalf("description = %q, want %q", got, tc.want)
			}
		})
	}
}
