import {
  ChevronsUpDown,
  LogOut
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import React from "react"
import { apiRequest } from "@/utils/requestUtils"
import { useNavigate } from "react-router-dom"
import { IconLockCode } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

export default function NavManager() {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()
  const [userEmail, setUserEmail] = React.useState<string>('');
  const [teamName, setTeamName] = React.useState<string>('');
  const [userName, setUserName] = React.useState<string>('');
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState<string>('');
  const [newPassword, setNewPassword] = React.useState<string>('');
  const [confirmPassword, setConfirmPassword] = React.useState<string>('');
  const [changingPassword, setChangingPassword] = React.useState<boolean>(false);
  const navigate = useNavigate()

  React.useEffect(() => {
    apiRequest('v1TeamsUsersStatusList', {}, [], (resp) => {
      if (resp.code === 0) {
        setUserEmail(resp.data?.user?.email || '');
        setTeamName(resp.data?.team?.name || '');
        setUserName(resp.data?.user?.name || '');
        localStorage.setItem('teamid', resp.data?.team?.team_id || '');
      } else {
        toast.error(t("managerShell.account.fetchFailed", { message: resp.message || t("managerShell.common.unknownError") }));
      }
    })
  }, [t]);

  const handleLogout = () => {
    apiRequest('v1TeamsUsersLogoutCreate', {}, [], (resp) => {
      if (resp.code === 0) {
        navigate('/');
      } else {
        toast.error(t("managerShell.account.logout.failed", { message: resp.message || t("managerShell.common.unknownError") }));
      }
    });
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("managerShell.account.changePassword.passwordMismatch"));
      return;
    }

    if (newPassword.length < 6) {
      toast.error(t("managerShell.account.changePassword.passwordTooShort", { count: 6 }))
      return;
    }

    setChangingPassword(true)
    await apiRequest('v1TeamsUsersPasswordsChangeUpdate', {
      current_password: currentPassword,
      new_password: newPassword,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerShell.account.changePassword.success"));
        setShowChangePasswordDialog(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(t("managerShell.account.changePassword.failed", { message: resp.message || t("managerShell.common.unknownError") }))
      }
    })
    setChangingPassword(false)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage alt={teamName} />
                  <AvatarFallback className="rounded-lg">{teamName.charAt(0) || '-'}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName} - {teamName || t("managerShell.account.unknownTeam")}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {userEmail}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage alt={teamName} />
                    <AvatarFallback className="rounded-lg">{teamName.charAt(0) || '-'}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{userName} - {teamName || t("managerShell.account.unknownTeam")}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {userEmail}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowChangePasswordDialog(true)}>
                <IconLockCode />
                {t("managerShell.account.changePassword.title")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogoutDialog(true)}>
                <LogOut />
                {t("managerShell.account.logout.action")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("managerShell.account.logout.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("managerShell.account.logout.confirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>
                  {t("managerShell.account.logout.confirmAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("managerShell.account.changePassword.title")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">{t("managerShell.account.changePassword.currentPassword")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.currentPasswordPlaceholder")}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t("managerShell.account.changePassword.newPassword")}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t("managerShell.account.changePassword.confirmPassword")}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder={t("managerShell.account.changePassword.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowChangePasswordDialog(false);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                >
                  {t("managerShell.common.cancel")}
                </Button>
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword && <Spinner className="size-4 mr-2" />}
                  {t("managerShell.account.changePassword.confirmAction")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
