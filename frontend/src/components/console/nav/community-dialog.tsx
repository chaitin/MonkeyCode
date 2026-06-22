import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useTranslation } from "react-i18next"

interface CommunityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const COMMUNITY_GROUPS = [
  { key: "wechat", src: "/wechat.png" },
  { key: "feishu", src: "/feishu.png" },
  { key: "dingtalk", src: "/dingtalk.png" },
] as const

export default function CommunityDialog({ open, onOpenChange }: CommunityDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="pb-0 pr-8">
          <DialogTitle>{t("consoleShell.community.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4 md:grid-cols-3">
            {COMMUNITY_GROUPS.map((group) => (
              <div key={group.key} className="flex flex-col items-center gap-3 rounded-xl border px-4 py-4">
                <div className="text-sm font-medium">{t(`consoleShell.community.groups.${group.key}.label`)}</div>
                <img
                  src={group.src}
                  alt={t(`consoleShell.community.groups.${group.key}.alt`)}
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
