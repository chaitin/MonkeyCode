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
import { useTranslation } from "react-i18next";

interface TeamMembersCardProps {
  members: any[];
  memberLimit: number;
  usedSeats: number;
  groups: any[];
  onRefreshMembers: () => void;
  onRefreshGroups?: () => void;
}

const ADD_MEMBER_ERROR_MATCHERS = {
  limit: ["limit", "\u4e0a\u9650"],
  deleted: ["deleted", "\u5220\u9664"],
  exists: ["exists", "\u5b58\u5728"],
};

export default function TeamMembersCard({ members, memberLimit, usedSeats, groups, onRefreshMembers, onRefreshGroups }: TeamMembersCardProps) {
  const { t } = useTranslation();
  const isOfflineEdition = import.meta.env.VITE_APP_EDITION === "offline";
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [generatedPasswords, setGeneratedPasswords] = useState<{ email?: string; password?: string }[]>([]);
  const [passwordDialogTitleKey, setPasswordDialogTitleKey] = useState("managerMembers.password.initialTitle");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<{ id?: string; email?: string }>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<{ id?: string; email?: string }>({});
  const [deleting, setDeleting] = useState(false);
  const errorMessage = (message?: string) => message || t("managerShell.common.unknownError");

  const getMemberGroups = (memberId: string) => {
    return groups.filter(group => 
      group.users?.some((user: any) => user.id === memberId)
    );
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const parseEmails = (emailString: string): string[] => {
    return emailString
      .split(/[,\n;]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);
  };

  const formatAddMemberError = (message?: string) => {
    if (!message) {
      return t("managerMembers.toast.addFailedGeneric");
    }
    if (ADD_MEMBER_ERROR_MATCHERS.limit.some((keyword) => message.includes(keyword))) {
      return t("managerMembers.toast.addFailedLimit");
    }
    if (ADD_MEMBER_ERROR_MATCHERS.deleted.some((keyword) => message.includes(keyword))) {
      return t("managerMembers.toast.addFailedDeleted");
    }
    if (ADD_MEMBER_ERROR_MATCHERS.exists.some((keyword) => message.includes(keyword))) {
      return t("managerMembers.toast.addFailedExists");
    }
    return t("managerMembers.toast.addFailedWithMessage", { message });
  };

  const handleAddMember = async () => {
    const emailList = parseEmails(emails);
    
    if (emailList.length === 0) {
      toast.error(t("managerMembers.toast.emailRequired"));
      return;
    }

    const invalidEmails = emailList.filter(email => !validateEmail(email));
    if (invalidEmails.length > 0) {
      toast.error(t("managerMembers.toast.invalidEmails", { emails: invalidEmails.join(", ") }));
      return;
    }
    const lowerEmails = emailList.map(email => email.toLowerCase());
    const duplicateEmails = emailList.filter((email, index) => lowerEmails.indexOf(email.toLowerCase()) !== index);
    if (duplicateEmails.length > 0) {
      toast.error(t("managerMembers.toast.duplicateEmails", { emails: Array.from(new Set(duplicateEmails)).join(", ") }));
      return;
    }

    setSubmitting(true);
    await apiRequest('v1TeamsUsersWithPasswordCreate', {
      emails: emailList,
      group_id: selectedGroupId || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerMembers.toast.added"));
        const passwords = resp.data?.passwords || [];
        setGeneratedPasswords(passwords);
        setPasswordDialogTitleKey("managerMembers.password.initialTitle");
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
      toast.success(t("managerMembers.toast.initialPasswordCopied"));
    } catch {
      toast.error(t("managerMembers.toast.copyFailed"));
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
        toast.success(currentStatus ? t("managerMembers.toast.enabled") : t("managerMembers.toast.disabled"));
        onRefreshMembers();
      } else {
        toast.error(t("managerMembers.toast.statusToggleFailed", { message: errorMessage(resp.message) }));
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
          toast.success(t("managerMembers.toast.resetPassword", { email: resettingPasswordUser.email || t("managerMembers.userFallback") }));
          setGeneratedPasswords(resp.data ? [resp.data] : []);
          setPasswordDialogTitleKey("managerMembers.password.resetTitle");
          setPasswordDialogOpen(!!resp.data?.password);
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error(t("managerMembers.toast.resetFailed", { message: errorMessage(resp.message) }));
        }
      })
    } else {
      const captchaToken = await captchaChallenge();
      if (!captchaToken) {
        toast.error(t("managerMembers.toast.captchaFailed"));
        setResettingPassword(false);
        return;
      }
      await apiRequest('v1UsersPasswordsResetRequestUpdate', {
        emails: [resettingPasswordUser.email],
        captcha_token: captchaToken,
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(t("managerMembers.toast.resetEmailSent", { email: resettingPasswordUser.email }));
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error(t("managerMembers.toast.resetEmailFailed", { message: errorMessage(resp.message) }));
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
        toast.success(t("managerMembers.toast.deleted", { email: deletingUser.email || "" }));
        setDeletingUser({});
        setDeleteDialogOpen(false);
        onRefreshMembers();
        onRefreshGroups?.();
      } else {
        toast.error(t("managerMembers.toast.deleteFailed", { message: errorMessage(resp.message) }));
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
            {t("managerMembers.title")}
          </CardTitle>
          <CardDescription>
            {t("managerMembers.count", { used: usedSeats, limit: memberLimit })}
          </CardDescription>
          <CardAction>
            <Button 
              variant="outline" 
              disabled={memberLimit <= usedSeats}
              onClick={() => setAddMemberDialogOpen(true)}
            >
              <IconCirclePlus />
              {t("managerMembers.actions.add")}
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
                      <span>{t("managerMembers.list.joined", { time: dayjs(member.created_at * 1000).fromNow() })}</span>
                      {!!member.last_active_at && (
                        <span>{t("managerMembers.list.lastActive", { time: dayjs(member.last_active_at * 1000).fromNow() })}</span>
                      )}
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
                            {t("managerMembers.actions.enable")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleToggleBlockStatus(member.user?.id || '', member.user?.is_blocked || false)}
                          >
                            <IconForbid />
                            {t("managerMembers.actions.disable")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleOpenResetPasswordDialog({ id: member.user?.id, email: member.user?.email })}
                        >
                          <IconLockCode />
                          {t("managerMembers.actions.resetPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleOpenDeleteDialog({ id: member.user?.id, email: member.user?.email })}
                        >
                          <IconTrash />
                          {t("managerMembers.actions.delete")}
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
            <DialogTitle>{t("managerMembers.dialogs.add.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{t("managerMembers.fields.email")}</FieldLabel>
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
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleAddMember} disabled={!emails.trim() || submitting}>
              {submitting ? t("managerMembers.actions.adding") : t("managerMembers.actions.addShort")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(passwordDialogTitleKey)}</DialogTitle>
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
              {t("managerMembers.actions.copy")}
            </Button>
            <Button onClick={() => setPasswordDialogOpen(false)}>
              {t("managerMembers.actions.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerMembers.dialogs.resetPassword.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isOfflineEdition
                ? t("managerMembers.dialogs.resetPassword.offlineDescription", { email: resettingPasswordUser.email })
                : t("managerMembers.dialogs.resetPassword.onlineDescription", { email: resettingPasswordUser.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelResetPassword} disabled={resettingPassword}>
              {t("managerShell.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmResetPassword} disabled={resettingPassword}>
              {resettingPassword ? t("managerMembers.dialogs.resetPassword.resetting") : t("managerMembers.dialogs.resetPassword.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerMembers.dialogs.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("managerMembers.dialogs.delete.description", { email: deletingUser.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete} disabled={deleting}>
              {t("managerShell.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? t("managerMembers.dialogs.delete.deleting") : t("managerMembers.dialogs.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
