package designcatalog

import "context"

type AccessConfig struct {
	PublicURL    string
	InstanceID   string
	PublisherID  string
	RespubURL    string
	RespubSecret string
	MediaSecret  string
}
type DeviceOwner interface {
	OwnedDevice(context.Context, string, string) (string, error)
}
