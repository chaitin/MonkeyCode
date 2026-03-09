import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { IconCirclePlus, IconDotsVertical, IconForbid, IconLockCode, IconUser, IconUserCircle, IconCheck } from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/utils/requestUtils";
import { toast } from "sonner";
import { captchaChallenge } from "@/utils/common";
import dayjs from "dayjs";

interface TeamMembersCardProps {
  members: any[];
  memberLimit: number;
  groups: any[];
  onRefreshMembers: () => void;
}

export default function TeamMembersCard({ members, memberLimit, groups, onRefreshMembers }: TeamMembersCardProps) {
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resettingPasswordEmail, setResettingPasswordEmail] = useState<string>("");
  const [resettingPassword, setResettingPassword] = useState(false);

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

    setSubmitting(true);
    await apiRequest('v1TeamsUsersCreate', {
      emails: emailList,
      group_id: selectedGroupId || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("成员添加成功");
        setAddMemberDialogOpen(false);
        setEmails("");
        setSelectedGroupId("");
        onRefreshMembers();
      } else {
        toast.error("成员添加失败: " + resp.message);
      }
    })
    setSubmitting(false);
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

  const handleOpenResetPasswordDialog = (email: string) => {
    setResettingPasswordEmail(email);
    setResetPasswordDialogOpen(true);
  };

  const handleCancelResetPassword = () => {
    setResettingPasswordEmail("");
    setResetPasswordDialogOpen(false);
  };

  const handleConfirmResetPassword = async () => {
    if (!resettingPasswordEmail) {
      return;
    }

    const captchaToken = await captchaChallenge();
    if (!captchaToken) {
      toast.error("验证码验证失败");
      return;
    }

    setResettingPassword(true);
    await apiRequest('v1UsersPasswordsResetRequestUpdate', {
      emails: [resettingPasswordEmail],
      captcha_token: captchaToken,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已为 ${resettingPasswordEmail} 发送密码重置邮件`);
        setResetPasswordDialogOpen(false);
        setResettingPasswordEmail("");
      } else {
        toast.error("发送密码重置邮件失败: " + resp.message);
      }
    })
    setResettingPassword(false);
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
                      <AvatarImage src={member.user?.avatar_url || "/logo-colored.png"} />
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
                          onClick={() => handleOpenResetPasswordDialog(member.user?.email)}
                        >
                          <IconLockCode />
                          重置密码
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

      <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重置密码</AlertDialogTitle>
            <AlertDialogDescription>
              确定要为成员 "{resettingPasswordEmail}" 重置密码吗？系统将发送密码重置邮件到该成员的邮箱。
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
    </>
  )
}

