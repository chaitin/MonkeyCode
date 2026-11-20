package license

import "context"

type Capabilities struct {
	AllowCloudComputer  bool `json:"allow_cloud_computer"`
	AllowCustomBranding bool `json:"allow_custom_branding"`
}

type Reader interface {
	Capabilities(context.Context) (Capabilities, error)
}

func Read(ctx context.Context, reader Reader) Capabilities {
	if reader == nil {
		return Capabilities{}
	}
	capabilities, err := reader.Capabilities(ctx)
	if err != nil {
		return Capabilities{}
	}
	return capabilities
}
