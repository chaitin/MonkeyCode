import { ArrowRight, ArrowUpRight, Megaphone, X } from "lucide-react"
import { Dialog } from "radix-ui"
import { Button, ButtonLink } from "@/components/ui/button"
import { promotion } from "@/lib/promotion"

export function PromotionBanner() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className="promotion-banner" aria-label={`${promotion.banner}，查看活动详情`}>
          <span className="promotion-banner-inner">
            <span className="promotion-banner-label"><Megaphone aria-hidden="true" />{promotion.label}</span>
            <span className="promotion-banner-copy">{promotion.banner}</span>
            <span className="promotion-banner-action">查看详情<ArrowRight aria-hidden="true" /></span>
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="promotion-overlay" />
        <Dialog.Content className="promotion-dialog">
          <Dialog.Title className="promotion-title">{promotion.title}</Dialog.Title>
          <Dialog.Description className="promotion-description">
            {promotion.description}
            <small className="promotion-note">补贴以<a href={promotion.cloud.href} target="_blank" rel="noopener noreferrer">{promotion.cloud.label}</a>「{promotion.coupon}」优惠券形式发放。</small>
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="promotion-close" aria-label="关闭活动详情">
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
          <div className="promotion-actions">
            <Dialog.Close asChild>
              <ButtonLink href={promotion.link.href} target="_blank" rel="noopener noreferrer">
                {promotion.link.label}<ArrowUpRight aria-hidden="true" />
              </ButtonLink>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
