import {
  ChevronsUpDown
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { IconLockCode, IconLogout, IconMail, IconUserHexagon, IconUpload } from "@tabler/icons-react"
import { useCommonData } from "@/components/console/data-provider"
import { isValidEmail } from "@/utils/common"

export default function NavUser() {
  const { isMobile } = useSidebar()
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState<string>('');
  const [newPassword, setNewPassword] = React.useState<string>('');
  const [confirmPassword, setConfirmPassword] = React.useState<string>('');
  const [changingPassword, setChangingPassword] = React.useState<boolean>(false);
  const [showBindEmailDialog, setShowBindEmailDialog] = React.useState(false);
  const [bindEmail, setBindEmail] = React.useState<string>('');
  const [bindingEmail, setBindingEmail] = React.useState<boolean>(false);
  const [showChangeNameDialog, setShowChangeNameDialog] = React.useState(false);
  const [newName, setNewName] = React.useState<string>('');
  const [changingName, setChangingName] = React.useState<boolean>(false);
  const [showChangeAvatarDialog, setShowChangeAvatarDialog] = React.useState(false);
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string>('');
  const [changingAvatar, setChangingAvatar] = React.useState<boolean>(false);
  const navigate = useNavigate()
  const { user, reloadUser } = useCommonData()
  const requiresCurrentPassword = !!user?.has_password
  const passwordActionLabel = requiresCurrentPassword ? '修改密码' : '设置密码'

  const handleLogout = () => {
    apiRequest('v1UsersLogoutCreate', {}, [], (resp) => {
      if (resp.code === 0) {
        navigate('/');
      } else {
        toast.error('登出失败: ' + resp.message);
      }
    });
  };

  const handleChangePassword = async () => {
    if (requiresCurrentPassword && !currentPassword) {
      toast.error('请输入当前密码');
      return;
    }

    // 验证新密码和确认密码是否一致
    if (newPassword !== confirmPassword) {
      toast.error('新密码和确认密码不一致');
      return;
    }

    // 验证密码长度
    if (newPassword.length < 8) {
      toast.error('新密码长度至少为8位');
      return;
    }

    setChangingPassword(true);
    await apiRequest('v1UsersPasswordsChangeUpdate', {
      current_password: requiresCurrentPassword ? currentPassword : undefined,
      new_password: newPassword,
    }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success('密码修改成功');
        setShowChangePasswordDialog(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(`密码修改失败：${resp?.message || '未知错误'}`);
      }
    })
    setChangingPassword(false);
  };

  const handleBindEmail = async () => {
    const email = bindEmail.trim();
    if (!isValidEmail(email)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }

    setBindingEmail(true);
    await apiRequest('v1UsersEmailBindRequestUpdate', {
      email,
    }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success('绑定邮件已发送，请前往邮箱完成验证');
        setShowBindEmailDialog(false);
        setBindEmail('');
      } else {
        toast.error(`绑定邮箱失败：${resp?.message || '未知错误'}`);
      }
    });
    setBindingEmail(false);
  };

  const handleChangeName = async () => {
    // 验证昵称不能为空
    if (!newName.trim()) {
      toast.error('昵称不能为空');
      return;
    }

    setChangingName(true);
    await apiRequest('v1UsersUpdate', { name: newName.trim() }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success('昵称修改成功');
        reloadUser?.();
        setShowChangeNameDialog(false);
        setNewName('');
      } else {
        toast.error(`昵称修改失败：${resp?.message || '未知错误'}`);
      }
    })
    setChangingName(false);
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件');
        return;
      }
      // 验证文件大小（例如限制为 5MB）
      if (file.size > 5 * 1024 * 1024) {
        toast.error('图片大小不能超过 5MB');
        return;
      }
      setAvatarFile(file);
      // 创建预览
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleChangeAvatar = async () => {
    if (!avatarFile) {
      toast.error('请选择头像文件');
      return;
    }

    setChangingAvatar(true);
    // 第一步：上传文件到 OSS
    await apiRequest('v1UploaderCreate', { usage: 'avatar', file: avatarFile }, [], async (uploadResp) => {
      if (uploadResp?.code === 0 && uploadResp?.data) {
        // 第二步：更新用户头像地址
        await apiRequest('v1UsersUpdate', { avatar_url: uploadResp.data }, [], (updateResp) => {
          if (updateResp?.code === 0) {
            toast.success('头像修改成功');
            setShowChangeAvatarDialog(false);
            setAvatarFile(null);
            setAvatarPreview('');
            // 重新加载用户信息以获取最新的头像URL
            reloadUser?.();
          } else {
            toast.error(`头像修改失败：${updateResp?.message || '未知错误'}`);
          }
        });
      } else {
        toast.error(`头像上传失败：${uploadResp?.message || '未知错误'}`);
      }
    });
    setChangingAvatar(false);
  };

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
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt={user?.name || '未知用户'} />
                  <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || '-'}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user?.name || '未知用户'}{user?.team ? ` - ${user?.team?.name}` : ''}</span>
                  <span className="truncate text-xs">{user?.email || '-'}</span>
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
                  <Avatar 
                    className="h-8 w-8 rounded-lg cursor-pointer hover:opacity-50 transition-opacity"
                    onClick={() => setShowChangeAvatarDialog(true)}
                  >
                    <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt={user?.name || '未知用户'} />
                    <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || '-'}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user?.name || '未知用户'}{user?.team ? ` - ${user?.team?.name}` : ''}</span>
                    <span className="truncate text-xs">{user?.email || '-'}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                setNewName(user?.name || '');
                setShowChangeNameDialog(true);
              }}>
                <IconUserHexagon />
                修改昵称
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!!user?.email}
                onClick={() => {
                  if (!user?.email) {
                    setBindEmail('');
                    setShowBindEmailDialog(true);
                  }
                }}
              >
                <IconMail />
                绑定邮箱
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowChangePasswordDialog(true)}>
                <IconLockCode />
                {passwordActionLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogoutDialog(true)}>
                <IconLogout />
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
        </SidebarMenuItem>
      </SidebarMenu>
      <Dialog open={showChangeNameDialog} onOpenChange={setShowChangeNameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改昵称</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">昵称</Label>
              <Input
                id="new-name"
                type="text"
                placeholder="请输入新昵称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowChangeNameDialog(false);
                setNewName('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleChangeName}
              disabled={changingName || !newName.trim()}
            >
              {changingName && <Spinner className="size-4 mr-2" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{passwordActionLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {requiresCurrentPassword && (
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
            )}
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
              disabled={changingPassword || (requiresCurrentPassword && !currentPassword) || !newPassword || !confirmPassword}
            >
              {changingPassword && <Spinner className="size-4 mr-2" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showBindEmailDialog} onOpenChange={setShowBindEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>绑定邮箱</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bind-email">邮箱</Label>
              <Input
                id="bind-email"
                type="email"
                placeholder="请输入要绑定的邮箱"
                value={bindEmail}
                onChange={(e) => setBindEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBindEmailDialog(false);
                setBindEmail('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleBindEmail}
              disabled={bindingEmail || !bindEmail.trim()}
            >
              {bindingEmail && <Spinner className="size-4 mr-2" />}
              发送验证邮件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showChangeAvatarDialog} onOpenChange={setShowChangeAvatarDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改头像</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            <label
              htmlFor="avatar-file"
              className="relative cursor-pointer group"
            >
              <Avatar className="h-32 w-32 rounded-lg border-2 border-border group-hover:border-primary transition-colors">
                {avatarPreview ? (
                  <>
                    <AvatarImage src={avatarPreview} alt="头像预览" />
                    <AvatarFallback className="rounded-lg">预览</AvatarFallback>
                  </>
                ) : (
                  <>
                    <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt="当前头像" />
                    <AvatarFallback className="rounded-lg text-3xl">
                      {user?.name?.charAt(0) || '-'}
                    </AvatarFallback>
                  </>
                )}
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity">
                <IconUpload className="h-8 w-8 text-white" />
              </div>
              <input
                id="avatar-file"
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                className="hidden"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowChangeAvatarDialog(false);
                setAvatarFile(null);
                setAvatarPreview('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleChangeAvatar}
              disabled={changingAvatar || !avatarFile}
            >
              {changingAvatar && <Spinner className="size-4 mr-2" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
