package domain

import "context"

// ProductEdition 表示当前服务的产品形态。
type ProductEdition string

const (
	// ProductEditionSaaS SaaS 版本。
	ProductEditionSaaS ProductEdition = "saas"
	// ProductEditionPrivate 私有化版本。
	ProductEditionPrivate ProductEdition = "private"
)

// ProductRegion 表示 SaaS 服务区域。
type ProductRegion string

const (
	// ProductRegionCN 国内 SaaS 区域。
	ProductRegionCN ProductRegion = "cn"
	// ProductRegionGlobal 海外 SaaS 区域。
	ProductRegionGlobal ProductRegion = "global"
)

type ServerConfig struct {
	// Edition 当前产品形态：SaaS 或私有化版本。
	Edition ProductEdition `json:"edition" enums:"saas,private" example:"saas"`
	// Region SaaS 区域，国内 SaaS 返回 cn，海外 SaaS 返回 global。
	Region ProductRegion `json:"region,omitempty" enums:"cn,global" example:"cn"`
}

type ServerConfigProvider interface {
	GetServerConfig(ctx context.Context) (ServerConfig, error)
}
