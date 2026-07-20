package v1

import "testing"

func TestValidateUploadFileSize(t *testing.T) {
	for _, tc := range []struct {
		name    string
		size    int64
		wantErr bool
	}{
		{name: "empty file", size: 0},
		{name: "exact limit", size: maxUploadFileSize},
		{name: "over limit", size: maxUploadFileSize + 1, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateUploadFileSize(tc.size)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateUploadFileSize(%d) error = %v, wantErr = %v", tc.size, err, tc.wantErr)
			}
		})
	}
}
