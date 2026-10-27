// Campaign copy and destinations shared by the banner and details dialog.
const title = "企业专享 1000 元算力补贴"

export const promotion = {
  label: "企业专享",
  banner: title,
  title,
  description: "百智办公可免费使用。企业用户在线登记并安装使用后，销售将根据登记信息与您联系，确认企业身份后赠送算力补贴。",
  cloud: { label: "百智云", href: "https://baizhi.cloud/" },
  coupon: "满 2000 减 1000",
  link: { label: "登记领取补贴", href: "https://baizhi.cloud/consult" },
} as const
