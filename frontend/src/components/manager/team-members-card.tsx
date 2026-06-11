import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { IconCirclePlus, IconCopy, IconDotsVertical, IconForbid, IconLockCode, IconUser, IconUserCircle, IconCheck, IconTrash } from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/utils/requestUtils";
import { captchaChallenge } from "@/utils/common";
import { toast } from "sonner";
import dayjs from "dayjs";

interface TeamMembersCardProps {
  members: any[];
  memberLimit: number;
  groups: any[];
  onRefreshMembers: () => void;
  onRefreshGroups?: () => void;
}

export default function TeamMembersCard({ members, memberLimit, groups, onRefreshMembers, onRefreshGroups }: TeamMembersCardProps) {
  const isOfflineEdition = import.meta.env.VITE_APP_EDITION === "offline";
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [generatedPasswords, setGeneratedPasswords] = useState<{ email?: string; password?: string }[]>([]);
  const [passwordDialogTitle, setPasswordDialogTitle] = useState("成员初始密码");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<{ id?: string; email?: string }>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<{ id?: string; email?: string }>({});
  const [deleting, setDeleting] = useState(false);

  // 获取成员所属的组
  const getMemberGroups = (memberId: string) => {
    return groups.filter(group => 
      group.users?.some((user: any) => user.id === memberId)
    );
  };

  // 验证邮箱格式
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  // 解析邮箱列表（支持换行和逗号分隔）
  const parseEmails = (emailString: string): string[] => {
    return emailString
      .split(/[,\n;]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);
  };

  const formatAddMemberError = (message?: string) => {
    if (!message) {
      return "成员添加失败，请稍后重试";
    }
    if (message.includes("limit") || message.includes("上限")) {
      return "成员添加失败：团队成员数量已达上限";
    }
    if (message.includes("deleted") || message.includes("删除")) {
      return "成员添加失败：邮箱对应用户已被删除，不能重复添加";
    }
    if (message.includes("exists") || message.includes("存在")) {
      return "成员添加失败：用户已在团队中";
    }
    return `成员添加失败：${message}`;
  };

  const handleAddMember = async () => {
    const emailList = parseEmails(emails);
    
    if (emailList.length === 0) {
      toast.error("请输入至少一个邮箱地址");
      return;
    }

    // 验证所有邮箱格式
    const invalidEmails = emailList.filter(email => !validateEmail(email));
    if (invalidEmails.length > 0) {
      toast.error(`以下邮箱格式不正确：${invalidEmails.join(", ")}`);
      return;
    }
    const lowerEmails = emailList.map(email => email.toLowerCase());
    const duplicateEmails = emailList.filter((email, index) => lowerEmails.indexOf(email.toLowerCase()) !== index);
    if (duplicateEmails.length > 0) {
      toast.error(`以下邮箱重复输入：${Array.from(new Set(duplicateEmails)).join(", ")}`);
      return;
    }

    setSubmitting(true);
    await apiRequest('v1TeamsUsersWithPasswordCreate', {
      emails: emailList,
      group_id: selectedGroupId || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("成员添加成功");
        const passwords = resp.data?.passwords || [];
        setGeneratedPasswords(passwords);
        setPasswordDialogTitle("成员初始密码");
        setPasswordDialogOpen(passwords.length > 0);
        setAddMemberDialogOpen(false);
        setEmails("");
        setSelectedGroupId("");
        onRefreshMembers();
      } else {
        toast.error(formatAddMemberError(resp.message));
      }
    })
    setSubmitting(false);
  };

  const handleCopyGeneratedPasswords = async () => {
    const text = generatedPasswords
      .map(item => `${item.email || ""}\t${item.password || ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("初始密码已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleCancelAddMember = () => {
    setAddMemberDialogOpen(false);
    setEmails("");
    setSelectedGroupId("");
  };

  const handleToggleBlockStatus = async (userId: string, currentStatus: boolean) => {
    await apiRequest( 'v1TeamsUsersUpdate', {
      is_blocked: !currentStatus,
    }, [userId], (resp) => {
      if (resp.code === 0) {
        toast.success(currentStatus ? "成员已启用" : "成员已禁用");
        onRefreshMembers();
      } else {
        toast.error("成员状态切换失败: " + resp.message);
      }
    })
  }

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
          toast.success(`已为 ${resettingPasswordUser.email || "该成员"} 重置密码`);
          setGeneratedPasswords(resp.data ? [resp.data] : []);
          setPasswordDialogTitle("成员重置密码");
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

  const handleOpenDeleteDialog = (user: { id?: string; email?: string }) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const handleCancelDelete = () => {
    setDeletingUser({});
    setDeleteDialogOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!deletingUser.id) {
      return;
    }
    setDeleting(true);
    await apiRequest('v1TeamsUsersDelete', {}, [deletingUser.id], (resp) => {
      if (resp.code === 0) {
        toast.success(`已删除成员 ${deletingUser.email || ""}`);
        setDeletingUser({});
        setDeleteDialogOpen(false);
        onRefreshMembers();
        onRefreshGroups?.();
      } else {
        toast.error("删除成员失败: " + resp.message);
      }
    })
    setDeleting(false);
  };

  return (
    <>
      <Card className="shadow-none flex-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconUserCircle />
            团队成员
          </CardTitle>
          <CardDescription>
            当前成员数量: {members.length} / {memberLimit}
          </CardDescription>
          <CardAction>
            <Button 
              variant="outline" 
              disabled={memberLimit <= members.length}
              onClick={() => setAddMemberDialogOpen(true)}
            >
              <IconCirclePlus />
              添加成员
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ItemGroup className="flex flex-col">
            {members.map((member) => (
              <Fragment key={member.user?.id}>
                <Separator />
                <Item variant="default" size="sm">
                  <ItemMedia className="hidden sm:flex">
                    <Avatar>
                      <AvatarImage src={member.user?.avatar_url || "/logo-light.png"} />
                      <AvatarFallback>
                        <IconUser className="size-4" />
                      </AvatarFallback>
                    </Avatar> 
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className={member.user?.is_blocked ? "line-through text-muted-foreground" : ""}>
                      {member.user?.name} - {member.user?.email}
                    </ItemTitle>
                    <ItemDescription className="flex flex-wrap gap-1">
                      {dayjs(member.created_at * 1000).fromNow()}加入
                      {!!member.last_active_at && `，${dayjs(member.last_active_at * 1000).fromNow()}使用过`}
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
                        {member.user?.is_blocked ? (
                          <DropdownMenuItem
                            onClick={() => handleToggleBlockStatus(member.user?.id || '', member.user?.is_blocked || false)}
                          >
                            <IconCheck />
                            设为启用
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleToggleBlockStatus(member.user?.id || '', member.user?.is_blocked || false)}
                          >
                            <IconForbid />
                            设为禁用
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleOpenResetPasswordDialog({ id: member.user?.id, email: member.user?.email })}
                        >
                          <IconLockCode />
                          重置密码
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleOpenDeleteDialog({ id: member.user?.id, email: member.user?.email })}
                        >
                          <IconTrash />
                          删除成员
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                  {getMemberGroups(member.user?.id || '').length > 0 && (
                    <ItemFooter className="flex flex-row gap-2 items-start pl-10 justify-start text-sm text-muted-foreground">
                      {getMemberGroups(member.user?.id || '').map((group) => (
                        <Badge key={group.id} variant="outline">{group.name}</Badge>
                      ))}
                    </ItemFooter>
                  )}
                </Item>
              </Fragment>
              ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加成员</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>邮箱地址</FieldLabel>
              <FieldContent>
                <Textarea
                  placeholder="user1@example.com; user2@example.com; user3@example.com"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  className="text-sm min-h-40 break-all"
                />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelAddMember} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleAddMember} disabled={!emails.trim() || submitting}>
              {submitting ? "添加中..." : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{passwordDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {generatedPasswords.map((item) => (
              <div key={item.email} className="rounded-md border p-3 text-sm">
                <div className="text-muted-foreground">{item.email}</div>
                <div className="mt-1 font-mono break-all">{item.password}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopyGeneratedPasswords} disabled={generatedPasswords.length === 0}>
              <IconCopy />
              复制
            </Button>
            <Button onClick={() => setPasswordDialogOpen(false)}>
              完成
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
                ? `确定要为成员 "${resettingPasswordUser.email}" 重置密码吗？系统将生成新密码，并仅在本次操作后展示一次。`
                : `确定要为成员 "${resettingPasswordUser.email}" 重置密码吗？系统将发送密码重置邮件到该成员的邮箱。`}
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除成员</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除成员 "{deletingUser.email}" 吗？删除后该成员将无法继续使用团队账号登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete} disabled={deleting}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
