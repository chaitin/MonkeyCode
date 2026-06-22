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
import { useTranslation } from "react-i18next";

export default function TeamManagerManager() {
  const { t } = useTranslation();
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
  const [passwordDialogTitleKey, setPasswordDialogTitleKey] = useState("managerAdmins.password.title");
  const errorMessage = (message?: string) => message || t("managerShell.common.unknownError");

  const fetchManagers = async () => {
    await apiRequest("v1TeamsUsersList", { role: "admin" }, [], (resp) => {
      if (resp.code === 0) {
        setManagers(resp.data?.members || []);
      } else {
        toast.error(t("managerAdmins.toast.fetchFailed", { message: errorMessage(resp.message) }));
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
      toast.error(t("managerAdmins.toast.emailRequired"));
      return;
    }
    if (!name.trim()) {
      toast.error(t("managerAdmins.toast.nameRequired"));
      return;
    }

    setSubmitting(true);
    await apiRequest("v1TeamsAdminCreate", { email: email.trim(), name: name.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerAdmins.toast.added"));
        const password = resp.data?.password || "";
        if (password) {
          setPasswordResult({ email: resp.data?.user?.user?.email || email.trim(), password });
          setPasswordDialogTitleKey("managerAdmins.password.initialTitle");
          setPasswordDialogOpen(true);
        }
        setAddDialogOpen(false);
        setEmail("");
        setName("");
        fetchManagers();
      } else {
        toast.error(t("managerAdmins.toast.addFailed", { message: errorMessage(resp.message) }));
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
      toast.error(t("managerAdmins.toast.nameRequired"));
      return;
    }
    await apiRequest("v1TeamsUsersUpdate", {
      name: editName.trim(),
      is_blocked: editBlocked,
    }, [userId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerAdmins.toast.updated"));
        setEditDialogOpen(false);
        setEditingManager(null);
        fetchManagers();
      } else {
        toast.error(t("managerAdmins.toast.updateFailed", { message: errorMessage(resp.message) }));
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
        toast.success(t("managerAdmins.toast.deleted"));
        setDeleteDialogOpen(false);
        setDeletingManager(null);
        fetchManagers();
      } else {
        toast.error(t("managerAdmins.toast.deleteFailed", { message: errorMessage(resp.message) }));
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
          toast.success(t("managerAdmins.toast.resetPassword", { email: resettingPasswordUser.email || t("managerAdmins.userFallback") }));
          setPasswordResult(resp.data || null);
          setPasswordDialogTitleKey("managerAdmins.password.resetTitle");
          setPasswordDialogOpen(!!resp.data?.password);
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error(t("managerAdmins.toast.resetFailed", { message: errorMessage(resp.message) }));
        }
      });
    } else {
      const captchaToken = await captchaChallenge();
      if (!captchaToken) {
        toast.error(t("managerAdmins.toast.captchaFailed"));
        setResettingPassword(false);
        return;
      }
      await apiRequest("v1UsersPasswordsResetRequestUpdate", {
        emails: [resettingPasswordUser.email],
        captcha_token: captchaToken,
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(t("managerAdmins.toast.resetEmailSent", { email: resettingPasswordUser.email }));
          setResetPasswordDialogOpen(false);
          setResettingPasswordUser({});
        } else {
          toast.error(t("managerAdmins.toast.resetEmailFailed", { message: errorMessage(resp.message) }));
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
      toast.success(t("managerAdmins.toast.passwordCopied"));
    } catch {
      toast.error(t("managerAdmins.toast.copyFailed"));
    }
  };

  return (
    <>
      <Card className="shadow-none flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconUserCircle />
            {t("managerAdmins.title")}
          </CardTitle>
          <CardDescription>{t("managerAdmins.count", { count: managers.length })}</CardDescription>
          <CardAction>
            <Button variant="outline" onClick={handleOpenAddDialog}>
              <IconCirclePlus />
              {t("managerAdmins.actions.add")}
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
                      <span>{t("managerAdmins.list.joined", { time: dayjs(manager.created_at * 1000).fromNow() })}</span>
                      {!!manager.last_active_at && (
                        <span>{t("managerAdmins.list.lastActive", { time: dayjs(manager.last_active_at * 1000).fromNow() })}</span>
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
                        <DropdownMenuItem onClick={() => handleOpenEditDialog(manager)}>
                          <IconEdit />
                          {t("managerAdmins.actions.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenResetPasswordDialog({ id: manager.user?.id, email: manager.user?.email })}>
                          <IconLockCode />
                          {t("managerAdmins.actions.resetPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenDeleteDialog(manager)}>
                          <IconTrash />
                          {t("managerAdmins.actions.delete")}
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
            <DialogTitle>{t("managerAdmins.dialogs.add.title")}</DialogTitle>
            <DialogDescription>{t("managerAdmins.dialogs.add.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{t("managerAdmins.fields.email")}</FieldLabel>
              <FieldContent>
                <Input type="email" placeholder={t("managerAdmins.fields.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("managerAdmins.fields.name")}</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("managerAdmins.fields.namePlaceholder")}
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
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleAddAdmin} disabled={!email.trim() || !name.trim() || submitting}>
              {submitting ? t("managerAdmins.actions.adding") : t("managerAdmins.actions.addShort")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("managerAdmins.dialogs.edit.title")}</DialogTitle>
            <DialogDescription>{t("managerAdmins.dialogs.edit.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{t("managerAdmins.fields.name")}</FieldLabel>
              <FieldContent>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("managerAdmins.fields.namePlaceholder")} />
              </FieldContent>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                <IconForbid className="size-4 text-muted-foreground" />
                <span>{t("managerAdmins.fields.blockAccount")}</span>
              </div>
              <Switch checked={editBlocked} onCheckedChange={setEditBlocked} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              {t("managerAdmins.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerAdmins.dialogs.resetPassword.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isOfflineEdition
                ? t("managerAdmins.dialogs.resetPassword.offlineDescription", { email: resettingPasswordUser.email })
                : t("managerAdmins.dialogs.resetPassword.onlineDescription", { email: resettingPasswordUser.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResetPasswordDialogOpen(false)} disabled={resettingPassword}>
              {t("managerShell.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmResetPassword} disabled={resettingPassword}>
              {resettingPassword ? t("managerAdmins.dialogs.resetPassword.resetting") : t("managerAdmins.dialogs.resetPassword.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerAdmins.dialogs.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("managerAdmins.dialogs.delete.description", { email: deletingManager?.user?.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              {t("managerShell.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? t("managerAdmins.dialogs.delete.deleting") : t("managerAdmins.dialogs.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(passwordDialogTitleKey)}</DialogTitle>
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
              {t("managerAdmins.actions.copy")}
            </Button>
            <Button onClick={() => setPasswordDialogOpen(false)}>{t("managerAdmins.actions.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
