import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/utils/requestUtils";
import { IconCirclePlus, IconChevronDown, IconDotsVertical, IconList, IconPencil, IconTrash, IconUser, IconUserPlus } from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface TeamGroupsCardProps {
  groups: any[];
  members: any[];
  onRefreshGroups: () => void;
}

export default function TeamGroupsCard({ groups, members, onRefreshGroups }: TeamGroupsCardProps) {
  const { t } = useTranslation();
  const [addGroupDialogOpen, setAddGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [deletingGroupName, setDeletingGroupName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [editGroupDialogOpen, setEditGroupDialogOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editMembersDialogOpen, setEditMembersDialogOpen] = useState(false);
  const [editingGroupMembersId, setEditingGroupMembersId] = useState<string | null>(null);
  const [editingGroupMembersName, setEditingGroupMembersName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [savingMembers, setSavingMembers] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const [sortedMembers, setSortedMembers] = useState<any[]>([]);
  const selectedMemberIdsRef = useRef<string[]>([]);
  const [viewMembersDialogOpen, setViewMembersDialogOpen] = useState(false);
  const [viewingGroup, setViewingGroup] = useState<{ id: string; name: string } | null>(null);
  const [viewingGroupMembers, setViewingGroupMembers] = useState<any[]>([]);
  const errorMessage = (message?: string) => message || t("managerShell.common.unknownError");

  const handleAddGroup = async () => {
    if (!groupName.trim()) {
      toast.error(t("managerGroups.toast.nameRequired"));
      return;
    }

    setSubmitting(true);
    await apiRequest('v1TeamsGroupsCreate', { name: groupName.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerGroups.toast.added"));
        setAddGroupDialogOpen(false);
        setGroupName("");
        onRefreshGroups();
      } else {
        toast.error(t("managerGroups.toast.addFailed", { message: errorMessage(resp.message) }));
      }
    })
    setSubmitting(false);
  }

  const handleCancelAddGroup = () => {
    setAddGroupDialogOpen(false);
    setGroupName("");
  }

  const handleDeleteGroup = (group: any) => {
    setDeletingGroupId(group.id);
    setDeletingGroupName(group.name);
    setDeleteDialogOpen(true);
  }

  const handleConfirmDelete = async () => {
    if (!deletingGroupId) return;

    setDeleting(true);
    await apiRequest('v1TeamsGroupsDelete', {}, [deletingGroupId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerGroups.toast.deleted"));
        setDeleteDialogOpen(false);
        setDeletingGroupId(null);
        setDeletingGroupName("");
        onRefreshGroups();
      } else {
        toast.error(t("managerGroups.toast.deleteFailed", { message: errorMessage(resp.message) }));
      }
    })
    setDeleting(false);
  }

  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
    setDeletingGroupId(null);
    setDeletingGroupName("");
  }

  const handleEditGroup = (group: any) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setEditGroupDialogOpen(true);
  }

  const handleUpdateGroup = async () => {
    if (!editingGroupId || !editingGroupName.trim()) {
      toast.error(t("managerGroups.toast.nameRequired"));
      return;
    }

    setUpdating(true);
    await apiRequest('v1TeamsGroupsUpdate', { name: editingGroupName.trim() }, [editingGroupId], (resp) => {
        if (resp.code === 0) {
          toast.success(t("managerGroups.toast.updated"));
          setEditGroupDialogOpen(false);
          setEditingGroupId(null);
          setEditingGroupName("");
          onRefreshGroups();
        } else {
          toast.error(t("managerGroups.toast.updateFailed", { message: errorMessage(resp.message) }));
        }
      })
    setUpdating(false);
  }

  const handleCancelEditGroup = () => {
    setEditGroupDialogOpen(false);
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  const handleEditGroupMembers = async (group: any) => {
    setEditingGroupMembersId(group.id);
    setEditingGroupMembersName(group.name);
    setSelectOpen(false);
    setEditMembersDialogOpen(true);
    
    const currentUserIds = (group.users || []).map((user: any) => user.id).filter((id: string) => id);
    setSelectedMemberIds([...currentUserIds]);
  }

  const handleMemberCheckboxChange = (memberId: string, checked: boolean) => {
    if (checked) {
      setSelectedMemberIds([...selectedMemberIds, memberId]);
    } else {
      setSelectedMemberIds(selectedMemberIds.filter(id => id !== memberId));
    }
  }

  const handleSaveGroupMembers = async () => {
    if (!editingGroupMembersId) return;

    setSavingMembers(true);
    
    await apiRequest('v1TeamsGroupsUsersUpdate', { user_ids: selectedMemberIds }, [editingGroupMembersId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerGroups.toast.membersUpdated"));
        setEditMembersDialogOpen(false);
        setEditingGroupMembersId(null);
        setEditingGroupMembersName("");
        setSelectedMemberIds([]);
        onRefreshGroups();
      } else {
        toast.error(t("managerGroups.toast.membersUpdateFailed", { message: errorMessage(resp.message) }));
      }
    })
    
    setSavingMembers(false);
  }

  const handleCancelEditMembers = () => {
    setEditMembersDialogOpen(false);
    setEditingGroupMembersId(null);
    setEditingGroupMembersName("");
    setSelectedMemberIds([]);
    setSelectOpen(false);
  }

  const handleViewGroupMembers = async (group: any) => {
    setViewingGroup({ id: group.id, name: group.name });
    setViewMembersDialogOpen(true);
    
    setViewingGroupMembers(group.users || []);
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setSelectOpen(false);
      }
    };

    if (selectOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectOpen]);

  useEffect(() => {
    selectedMemberIdsRef.current = selectedMemberIds;
  }, [selectedMemberIds]);

  useEffect(() => {
    if (selectOpen && members.length > 0) {
      const sorted = [...members].sort((a, b) => {
        const currentSelectedIds = selectedMemberIdsRef.current;
        const aChecked = currentSelectedIds.includes(a.user?.id || '');
        const bChecked = currentSelectedIds.includes(b.user?.id || '');
        
        if (aChecked && !bChecked) return -1;
        if (!aChecked && bChecked) return 1;
        
        const aEmail = (a.user?.email || '').toLowerCase();
        const bEmail = (b.user?.email || '').toLowerCase();
        return aEmail.localeCompare(bEmail);
      });
      setSortedMembers(sorted);
    } else if (!selectOpen) {
      setSortedMembers([]);
    }
  }, [selectOpen, members]);


  return (
    <>
      <Card className="shadow-none flex-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconList />
            {t("managerGroups.title")}
          </CardTitle>
          <CardDescription>
            {t("managerGroups.description")}
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => setAddGroupDialogOpen(true)}>
              <IconCirclePlus />
              {t("managerGroups.actions.add")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ItemGroup className="flex flex-col">
            {groups.map((group) => (
              <Fragment key={group.id}>
                <Separator />
                <Item variant="default" size="sm" key={group.id}>
                  <ItemContent>
                    <ItemTitle>{group.name}</ItemTitle>
                    <ItemDescription 
                      className="cursor-pointer hover:text-primary"
                      onClick={() => handleViewGroupMembers(group)}
                    >
                      {t("managerGroups.members.count", { count: group.users?.length || 0 })}
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
                        <DropdownMenuItem onClick={() => handleEditGroup(group)}>
                          <IconPencil />
                          {t("managerGroups.actions.editName")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEditGroupMembers(group)}>
                          <IconUserPlus />
                          {t("managerGroups.actions.editMembers")}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive" 
                          onClick={() => handleDeleteGroup(group)}
                        >
                          <IconTrash />
                          {t("managerGroups.actions.delete")}
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

      <Dialog open={addGroupDialogOpen} onOpenChange={setAddGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("managerGroups.dialogs.add.title")}</DialogTitle>
            <DialogDescription>
              {t("managerGroups.dialogs.add.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{t("managerGroups.fields.name")}</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("managerGroups.fields.namePlaceholder")}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && groupName.trim() && !submitting) {
                      handleAddGroup();
                    }
                  }}
                  autoFocus
                />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelAddGroup} disabled={submitting}>
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleAddGroup} disabled={!groupName.trim() || submitting}>
              {t("managerGroups.actions.addShort")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerGroups.dialogs.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("managerGroups.dialogs.delete.description", { name: deletingGroupName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete} disabled={deleting}>
              {t("managerShell.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? t("managerGroups.dialogs.delete.deleting") : t("managerGroups.dialogs.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editGroupDialogOpen} onOpenChange={setEditGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("managerGroups.dialogs.edit.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{t("managerGroups.fields.name")}</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("managerGroups.fields.namePlaceholder")}
                  value={editingGroupName}
                  onChange={(e) => setEditingGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editingGroupName.trim() && !updating) {
                      handleUpdateGroup();
                    }
                  }}
                  autoFocus
                />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelEditGroup} disabled={updating}>
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleUpdateGroup} disabled={!editingGroupName.trim() || updating}>
              {updating ? t("managerGroups.dialogs.edit.updating") : t("managerGroups.dialogs.edit.update")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editMembersDialogOpen} onOpenChange={(open) => {
        setEditMembersDialogOpen(open);
        if (!open) {
          setSelectOpen(false);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("managerGroups.dialogs.members.title", { name: editingGroupMembersName })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldContent>
                <div className="relative" ref={selectRef}>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={selectOpen}
                    className="w-full justify-between"
                    onClick={() => setSelectOpen(!selectOpen)}
                  >
                    <span className="truncate">
                      {selectedMemberIds.length === 0
                        ? t("managerGroups.members.selectPlaceholder")
                        : selectedMemberIds.length === 1
                        ? members.find((m) => m.user?.id === selectedMemberIds[0])?.user?.name || t("managerGroups.members.selectedOne")
                        : t("managerGroups.members.selectedMany", { count: selectedMemberIds.length })}
                    </span>
                    <IconChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                  </Button>
                  {selectOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                      <div className="max-h-[300px] overflow-auto p-1">
                        {sortedMembers.length === 0 ? (
                          <div className="py-6 text-center text-sm text-muted-foreground">
                            {t("managerGroups.members.empty")}
                          </div>
                        ) : (
                          sortedMembers.map((member) => {
                            const isChecked = selectedMemberIds.includes(member.user?.id || '');
                            return (
                              <div
                                key={member.user?.id}
                                className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent cursor-pointer"
                                onClick={() => handleMemberCheckboxChange(member.user?.id || '', !isChecked)}
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => handleMemberCheckboxChange(member.user?.id || '', checked as boolean)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Avatar className="size-6">
                                  <AvatarImage src={member.user?.avatar_url || "/logo-light.png"} />
                                  <AvatarFallback>
                                    <IconUser className="size-4" />
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{member.user?.name}</div>
                                  <div className="text-xs text-muted-foreground truncate">{member.user?.email}</div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelEditMembers} disabled={savingMembers}>
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleSaveGroupMembers} disabled={savingMembers}>
              {savingMembers ? t("managerGroups.dialogs.members.saving") : t("managerGroups.dialogs.members.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewMembersDialogOpen} onOpenChange={setViewMembersDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("managerGroups.dialogs.viewMembers.title", { name: viewingGroup?.name })}</DialogTitle>
            <DialogDescription>
              {t("managerGroups.dialogs.viewMembers.count", { count: viewingGroupMembers.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {viewingGroupMembers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("managerGroups.dialogs.viewMembers.empty")}
              </div>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <div className="flex flex-wrap gap-2">
                  {viewingGroupMembers.map((user) => (
                    <Badge key={user.id} variant="outline">
                      {user.email}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewMembersDialogOpen(false)}>
              {t("managerShell.common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
