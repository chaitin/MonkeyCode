package designcatalog

import "context"

type AccessConfig struct {
	PublicURL      string
	InstanceID     string
	LookupInstance func(context.Context) (string, error)
	PublisherID    string
	RespubURL      string
	RespubSecret   string
	MediaSecret    string
}

// 首次安装时代理可能先于管理服务就绪；首次读取失败不应永久禁用签发。
func (cfg AccessConfig) instance(ctx context.Context) string {
	if cfg.InstanceID != "" || cfg.LookupInstance == nil {
		return cfg.InstanceID
	}
	id, err := cfg.LookupInstance(ctx)
	if err != nil {
		return ""
	}
	return id
}

type DeviceOwner interface {
	OwnedDevice(context.Context, string, string) (string, error)
}
