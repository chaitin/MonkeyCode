import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ItemDescription } from "@/components/ui/item";
import { ItemActions } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/utils/requestUtils";
import { IconCirclePlus, IconUser, IconUserCircle } from "@tabler/icons-react";
import { IconLockCode } from "@tabler/icons-react";
import { IconCopy } from "@tabler/icons-react";
import { IconDotsVertical } from "@tabler/icons-react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Fragment, useState } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { captchaChallenge } from "@/utils/common";
import dayjs from "dayjs";



export default function TeamManagerManager() {

  const isOfflineEdition = import.meta.env.VITE_APP_EDITION === "offline";
  const [managers, setManagers] = useState<any[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<{ id?: string; email?: string }>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ email?: string; password?: string } | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const fetchManagers = async () => {
    await apiRequest('v1TeamsUsersList', { role: "admin" }, [], (resp) => {
      if (resp.code === 0) {
        setManagers(resp.data?.members || []);
      } else {
        toast.error("获取管理员列表失败: " + resp.message);
      }
    })
  }

  useEffect(() => {
    fetchManagers();
  }, []);

  const handleOpenAddDialog = () => {
    setEmail("");
    setName("");
    setAddDialogOpen(true);
  };

  const handleCancelAdd = () => {
    setAddDialogOpen(false);
  };

  const handleAddAdmin = async () => {
    if (!email.trim()) {
      toast.error("请输入邮箱地址");
      return;
    }
    if (!name.trim()) {
      toast.error("请输入姓名");
      return;
    }

    setSubmitting(true);
    await apiRequest('v1TeamsAdminCreate', { email: email.trim(), name: name.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("添加管理员成功");
        setAddDialogOpen(false);
        fetchManagers();
      } else {
        toast.error("添加管理员失败: " + resp.message);
      }
    })
    setSubmitting(false);
  };

  const handleOpenResetPasswordDialog = (user: { id?: string; email?: string }) => {
    setResettingPasswordUser(user);
    setResetPasswordDialogOpen(true);
  };

  const handleCancelResetPassword = () => {
    setResettingPasswordUser({});
    setResetPasswordDialogOpen(false);
  };

  const handleConfirmResetPassword = async () => {
    if (!resettingPasswordUser.email) {
      return;
    }

    setResettingPassword(true);
    if (isOfflineEdition) {
      if (!resettingPasswordUser.id) {
        setResettingPassword(false);
        return;
      }
      await apiRequest('v1TeamsUsersPasswordsResetUpdate', {}, [resettingPasswordUser.id], (resp) => {
        if (resp.code === 0) {
          toast.success(`已为 ${resettingPasswordUser.email || "该管理员"} 重置密码`);
          setResetPasswordResult(resp.data || null);
          setPasswordDialogOpen(!!resp.data?.password);
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error("重置密码失败: " + resp.message);
        }
      })
    } else {
      const captchaToken = await captchaChallenge();
      if (!captchaToken) {
        toast.error("验证码验证失败");
        setResettingPassword(false);
        return;
      }
      await apiRequest('v1UsersPasswordsResetRequestUpdate', {
        emails: [resettingPasswordUser.email],
        captcha_token: captchaToken,
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(`已为 ${resettingPasswordUser.email} 发送密码重置邮件`);
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error("发送密码重置邮件失败: " + resp.message);
        }
      })
    }
    setResettingPassword(false);
  };

  const handleCopyResetPassword = async () => {
    if (!resetPasswordResult) {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${resetPasswordResult.email || ""}\t${resetPasswordResult.password || ""}`);
      toast.success("新密码已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    <>
    <Card className="shadow-none flex-1">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <IconUserCircle />
        管理员
      </CardTitle>
      <CardDescription>
        共 {managers.length} 个管理员
      </CardDescription>
      <CardAction>
        <Button 
          variant="outline"
          onClick={handleOpenAddDialog}
        >
          <IconCirclePlus />
          添加管理员
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <ItemGroup className="flex flex-col">
        {managers.map((manager) => (
          <Fragment key={manager.user?.id}>
            <Separator />
            <Item variant="default" size="sm">
              <ItemMedia className="hidden sm:flex">
                <Avatar>
                  <AvatarImage src={manager.user?.avatar_url || "/logo-light.png"} />
                  <AvatarFallback>
                    <IconUser className="size-4" />
                  </AvatarFallback>
                </Avatar> 
              </ItemMedia>
              <ItemContent>
                <ItemTitle className={manager.user?.is_blocked ? "line-through text-muted-foreground" : ""}>
                  {manager.user?.name} - {manager.user?.email}
                </ItemTitle>
                <ItemDescription className="flex flex-wrap gap-1">
                  {dayjs(manager.created_at * 1000).fromNow()}加入
                  {manager.last_active_at !== 0 && `，${dayjs(manager.last_active_at * 1000).fromNow()}使用过`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <IconDotsVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleOpenResetPasswordDialog({ id: manager.user?.id, email: manager.user?.email })}
                    >
                      <IconLockCode />
                      重置密码
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          </Fragment>
          ))}
      </ItemGroup>
    </CardContent>
  </Card>

  <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>添加管理员</DialogTitle>
        <DialogDescription>
          请输入管理员的邮箱和姓名
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Field>
          <FieldLabel>邮箱地址</FieldLabel>
          <FieldContent>
            <Input
              type="email"
              placeholder="请输入邮箱地址"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>姓名</FieldLabel>
          <FieldContent>
            <Input
              placeholder="请输入姓名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.trim() && name.trim() && !submitting) {
                  handleAddAdmin();
                }
              }}
            />
          </FieldContent>
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleCancelAdd} disabled={submitting}>
          取消
        </Button>
        <Button onClick={handleAddAdmin} disabled={!email.trim() || !name.trim() || submitting}>
          {submitting ? "添加中..." : "添加"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>确认重置密码</AlertDialogTitle>
        <AlertDialogDescription>
          {isOfflineEdition
            ? `确定要为管理员 "${resettingPasswordUser.email}" 重置密码吗？系统将生成新密码，并仅在本次操作后展示一次。`
            : `确定要为管理员 "${resettingPasswordUser.email}" 重置密码吗？系统将发送密码重置邮件到该管理员的邮箱。`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={handleCancelResetPassword} disabled={resettingPassword}>
          取消
        </AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirmResetPassword} disabled={resettingPassword}>
          {resettingPassword ? "重置中..." : "确认重置"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>管理员重置密码</DialogTitle>
      </DialogHeader>
      {resetPasswordResult && (
        <div className="rounded-md border p-3 text-sm">
          <div className="text-muted-foreground">{resetPasswordResult.email}</div>
          <div className="mt-1 font-mono break-all">{resetPasswordResult.password}</div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={handleCopyResetPassword} disabled={!resetPasswordResult?.password}>
          <IconCopy />
          复制
        </Button>
        <Button onClick={() => setPasswordDialogOpen(false)}>
          完成
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  </>
  )
}
