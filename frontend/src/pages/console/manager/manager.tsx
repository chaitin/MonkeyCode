import { Fragment, useEffect, useState } from "react";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  IconCirclePlus,
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconForbid,
  IconLockCode,
  IconTrash,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { captchaChallenge } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";

export default function TeamManagerManager() {
  const isOfflineEdition = import.meta.env.VITE_APP_EDITION === "offline";
  const [managers, setManagers] = useState<any[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editBlocked, setEditBlocked] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingManager, setDeletingManager] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<{ id?: string; email?: string }>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState<{ email?: string; password?: string } | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordDialogTitle, setPasswordDialogTitle] = useState("管理员密码");

  const fetchManagers = async () => {
    await apiRequest("v1TeamsUsersList", { role: "admin" }, [], (resp) => {
      if (resp.code === 0) {
        setManagers(resp.data?.members || []);
      } else {
        toast.error("获取管理员列表失败: " + resp.message);
      }
    });
  };

  useEffect(() => {
    fetchManagers();
  }, []);

  const handleOpenAddDialog = () => {
    setEmail("");
    setName("");
    setAddDialogOpen(true);
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
    await apiRequest("v1TeamsAdminCreate", { email: email.trim(), name: name.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("添加管理员成功");
        const password = resp.data?.password || "";
        if (password) {
          setPasswordResult({ email: resp.data?.user?.user?.email || email.trim(), password });
          setPasswordDialogTitle("管理员初始密码");
          setPasswordDialogOpen(true);
        }
        setAddDialogOpen(false);
        setEmail("");
        setName("");
        fetchManagers();
      } else {
        toast.error("添加管理员失败: " + resp.message);
      }
    });
    setSubmitting(false);
  };

  const handleOpenEditDialog = (manager: any) => {
    setEditingManager(manager);
    setEditName(manager.user?.name || "");
    setEditBlocked(!!manager.user?.is_blocked);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    const userId = editingManager?.user?.id;
    if (!userId) {
      return;
    }
    if (!editName.trim()) {
      toast.error("请输入姓名");
      return;
    }
    await apiRequest("v1TeamsUsersUpdate", {
      name: editName.trim(),
      is_blocked: editBlocked,
    }, [userId], (resp) => {
      if (resp.code === 0) {
        toast.success("管理员已更新");
        setEditDialogOpen(false);
        setEditingManager(null);
        fetchManagers();
      } else {
        toast.error("更新管理员失败: " + resp.message);
      }
    });
  };

  const handleOpenDeleteDialog = (manager: any) => {
    setDeletingManager(manager);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    const userId = deletingManager?.user?.id;
    if (!userId) {
      return;
    }
    setDeleting(true);
    await apiRequest("v1TeamsUsersDelete", {}, [userId], (resp) => {
      if (resp.code === 0) {
        toast.success("管理员已删除");
        setDeleteDialogOpen(false);
        setDeletingManager(null);
        fetchManagers();
      } else {
        toast.error("删除管理员失败: " + resp.message);
      }
    });
    setDeleting(false);
  };

  const handleOpenResetPasswordDialog = (user: { id?: string; email?: string }) => {
    setResettingPasswordUser(user);
    setResetPasswordDialogOpen(true);
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
      await apiRequest("v1TeamsUsersPasswordsResetUpdate", {}, [resettingPasswordUser.id], (resp) => {
        if (resp.code === 0) {
          toast.success(`已为 ${resettingPasswordUser.email || "该管理员"} 重置密码`);
          setPasswordResult(resp.data || null);
          setPasswordDialogTitle("管理员重置密码");
          setPasswordDialogOpen(!!resp.data?.password);
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error("重置密码失败: " + resp.message);
        }
      });
    } else {
      const captchaToken = await captchaChallenge();
      if (!captchaToken) {
        toast.error("验证码验证失败");
        setResettingPassword(false);
        return;
      }
      await apiRequest("v1UsersPasswordsResetRequestUpdate", {
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
      });
    }
    setResettingPassword(false);
  };

  const handleCopyPassword = async () => {
    if (!passwordResult) {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${passwordResult.email || ""}\t${passwordResult.password || ""}`);
      toast.success("密码已复制到剪贴板");
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
          <CardDescription>共 {managers.length} 个管理员</CardDescription>
          <CardAction>
            <Button variant="outline" onClick={handleOpenAddDialog}>
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
                      {!!manager.last_active_at && `，${dayjs(manager.last_active_at * 1000).fromNow()}使用过`}
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
                        <DropdownMenuItem onClick={() => handleOpenEditDialog(manager)}>
                          <IconEdit />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenResetPasswordDialog({ id: manager.user?.id, email: manager.user?.email })}>
                          <IconLockCode />
                          重置密码
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenDeleteDialog(manager)}>
                          <IconTrash />
                          删除
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
            <DialogDescription>请输入管理员的邮箱和姓名</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>邮箱地址</FieldLabel>
              <FieldContent>
                <Input type="email" placeholder="请输入邮箱地址" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
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
                    if (e.key === "Enter" && email.trim() && name.trim() && !submitting) {
                      handleAddAdmin();
                    }
                  }}
                />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleAddAdmin} disabled={!email.trim() || !name.trim() || submitting}>
              {submitting ? "添加中..." : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑管理员</DialogTitle>
            <DialogDescription>修改管理员姓名和账号状态</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>姓名</FieldLabel>
              <FieldContent>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入姓名" />
              </FieldContent>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                <IconForbid className="size-4 text-muted-foreground" />
                <span>禁用账号</span>
              </div>
              <Switch checked={editBlocked} onCheckedChange={setEditBlocked} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              保存
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
            <AlertDialogCancel onClick={() => setResetPasswordDialogOpen(false)} disabled={resettingPassword}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmResetPassword} disabled={resettingPassword}>
              {resettingPassword ? "重置中..." : "确认重置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除管理员</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除管理员 "{deletingManager?.user?.email}" 吗？删除后该账号将无法继续作为团队管理员登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{passwordDialogTitle}</DialogTitle>
          </DialogHeader>
          {passwordResult && (
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">{passwordResult.email}</div>
              <div className="mt-1 font-mono break-all">{passwordResult.password}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCopyPassword} disabled={!passwordResult?.password}>
              <IconCopy />
              复制
            </Button>
            <Button onClick={() => setPasswordDialogOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
