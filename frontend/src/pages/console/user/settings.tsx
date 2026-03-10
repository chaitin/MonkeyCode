import Images from "@/components/console/settings/images"
import Models from "@/components/console/settings/models"
import Hosts from "@/components/console/settings/hosts"
import Identities from "@/components/console/settings/identities"
import VmsPage from "@/components/console/settings/vms"
import Notifications from "@/components/console/settings/notifications"
import { useGitHubSetupCallback } from "@/hooks/useGitHubSetupCallback"
import { useCommonData } from "@/components/console/data-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function SettingsPage() {
  const { reloadIdentities } = useCommonData()

  const { result, dismiss } = useGitHubSetupCallback(() => {
    reloadIdentities()
  })

  return (
    <div className="flex flex-col gap-4">
      <Identities />
      <Models />
      <Images />
      <Hosts />
      <VmsPage />
      <Notifications />

      <AlertDialog open={result !== null} onOpenChange={(open) => { if (!open) dismiss() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {result?.type === 'success' ? 'GitHub App 安装成功' : 'GitHub App 安装失败'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {result?.type === 'success'
                ? (result.accountLogin
                    ? `已关联到账户 ${result.accountLogin}`
                    : 'GitHub App 已成功安装')
                : `安装失败 (${result?.reason}): ${result?.message}`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismiss}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
