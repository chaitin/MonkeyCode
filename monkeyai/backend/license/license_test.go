package license

import (
	"context"
	"errors"
	"testing"
)

type source struct {
	value Capabilities
	err   error
}

func (s source) Capabilities(context.Context) (Capabilities, error) { return s.value, s.err }

func TestReadCapabilities(t *testing.T) {
	all := Capabilities{AllowHostInstallation: true, AllowCloudComputer: true, AllowCustomBranding: true}
	for _, tc := range []struct {
		reader Reader
		want   Capabilities
	}{
		{nil, Capabilities{}},
		{source{value: all}, all},
		{source{}, Capabilities{}},
		{source{value: all, err: errors.New("unavailable")}, Capabilities{}},
	} {
		if got := Read(t.Context(), tc.reader); got != tc.want {
			t.Fatalf("能力=%+v，期望=%+v", got, tc.want)
		}
	}
}
