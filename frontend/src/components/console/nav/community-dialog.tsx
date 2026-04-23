import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface CommunityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const COMMUNITY_GROUPS = [
  { src: "/wechat.png", alt: "微信二维码", label: "微信群" },
  { src: "/feishu.png", alt: "飞书群二维码", label: "飞书群" },
  { src: "/dingtalk.png", alt: "钉钉群二维码", label: "钉钉群" },
] as const

export default function CommunityDialog({ open, onOpenChange }: CommunityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="pb-0 pr-8">
          <DialogTitle>扫码加入技术交流群</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4 md:grid-cols-3">
            {COMMUNITY_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col items-center gap-3 rounded-xl border px-4 py-4">
                <div className="text-sm font-medium">{group.label}</div>
                <img
                  src={group.src}
                  alt={group.alt}
                  className="h-36 w-36 rounded-lg object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
