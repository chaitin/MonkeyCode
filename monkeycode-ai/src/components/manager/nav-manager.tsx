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

export default function NavManager() {
  const { isMobile } = useSidebar()
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
        toast.error('获取用户信息失败: ' + resp.message);
      }
    })
  }, []);

  const handleLogout = () => {
    apiRequest('v1TeamsUsersLogoutCreate', {}, [], (resp) => {
      if (resp.code === 0) {
        navigate('/');
      } else {
        toast.error('登出失败: ' + resp.message);
      }
    });
  };

  const handleChangePassword = async () => {
    // 验证新密码和确认密码是否一致
    if (newPassword !== confirmPassword) {
      toast.error('新密码和确认密码不一致');
      return;
    }

    // 验证密码长度
    if (newPassword.length < 6) {
      toast.error('新密码长度至少为6位')
      return;
    }

    setChangingPassword(true)
    await apiRequest('v1TeamsUsersPasswordsChangeUpdate', {
      current_password: currentPassword,
      new_password: newPassword,
    }, [], (resp) => {
      // 只有在成功时才关闭对话框
      if (resp.code === 0) {
        toast.success('密码修改成功');
        setShowChangePasswordDialog(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        // 失败时不关闭对话框，只显示错误提示
        toast.error(`密码修改失败：${resp.message || '未知错误'}`)
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
                  <span className="truncate font-medium">{userName} - {teamName || '未知团队'}</span>
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
                    <span className="truncate font-medium">{userName} - {teamName || '未知团队'}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {userEmail}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowChangePasswordDialog(true)}>
                <IconLockCode />
                修改密码
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogoutDialog(true)}>
                <LogOut />
                登出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认登出</AlertDialogTitle>
                <AlertDialogDescription>
                  您确定要登出吗？登出后需要重新登录才能继续使用。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>
                  确认登出
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>修改密码</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">当前密码</Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder="请输入当前密码"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">新密码</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="请输入新密码"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">确认新密码</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="请再次输入新密码"
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
                  取消
                </Button>
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword && <Spinner className="size-4 mr-2" />}
                  确认修改
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
