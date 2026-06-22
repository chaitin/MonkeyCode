package domain

import "context"

// ProductEdition 表示当前服务的产品形态。
type ProductEdition string

const (
	// ProductEditionSaaSCN 国内 SaaS 版本。
	ProductEditionSaaSCN ProductEdition = "saas_cn"
	// ProductEditionSaaSGlobal 海外 SaaS 版本。
	ProductEditionSaaSGlobal ProductEdition = "saas_global"
	// ProductEditionPrivate 私有化版本。
	ProductEditionPrivate ProductEdition = "private"
)

type ProductVersion struct {
	// Edition 当前产品形态：国内 SaaS、海外 SaaS 或私有化版本。
	Edition ProductEdition `json:"edition" example:"saas_cn"`
}

type ProductVersionProvider interface {
	GetProductVersion(ctx context.Context) (ProductVersion, error)
}
