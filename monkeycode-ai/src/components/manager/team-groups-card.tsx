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

interface TeamGroupsCardProps {
  groups: any[];
  members: any[];
  onRefreshGroups: () => void;
}

export default function TeamGroupsCard({ groups, members, onRefreshGroups }: TeamGroupsCardProps) {
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

  const handleAddGroup = async () => {
    if (!groupName.trim()) {
      toast.error("请输入分组名称");
      return;
    }

    setSubmitting(true);
    await apiRequest('v1TeamsGroupsCreate', { name: groupName.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("分组添加成功");
        setAddGroupDialogOpen(false);
        setGroupName("");
        onRefreshGroups();
      } else {
        toast.error("添加分组失败: " + resp.message);
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
        toast.success("分组删除成功");
        setDeleteDialogOpen(false);
        setDeletingGroupId(null);
        setDeletingGroupName("");
        onRefreshGroups();
      } else {
        toast.error("删除分组失败: " + resp.message);
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
      toast.error("请输入分组名称");
      return;
    }

    setUpdating(true);
    await apiRequest('v1TeamsGroupsUpdate', { name: editingGroupName.trim() }, [editingGroupId], (resp) => {
        if (resp.code === 0) {
          toast.success("分组更新成功");
          setEditGroupDialogOpen(false);
          setEditingGroupId(null);
          setEditingGroupName("");
          onRefreshGroups();
        } else {
          toast.error("更新分组失败: " + resp.message);
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
    
    // 获取当前分组的成员列表
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
        toast.success("成员更新成功");
        setEditMembersDialogOpen(false);
        setEditingGroupMembersId(null);
        setEditingGroupMembersName("");
        setSelectedMemberIds([]);
        onRefreshGroups();
      } else {
        toast.error("更新成员失败: " + resp.message);
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
    
    // 获取分组的成员列表
    setViewingGroupMembers(group.users || []);
  }

  // 点击外部关闭下拉框
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

  // 更新 ref 以跟踪最新的选中状态
  useEffect(() => {
    selectedMemberIdsRef.current = selectedMemberIds;
  }, [selectedMemberIds]);

  // 只在展开下拉框时排序成员列表
  useEffect(() => {
    if (selectOpen && members.length > 0) {
      const sorted = [...members].sort((a, b) => {
        // 使用 ref 中的最新值，而不是闭包中的值
        const currentSelectedIds = selectedMemberIdsRef.current;
        const aChecked = currentSelectedIds.includes(a.user?.id || '');
        const bChecked = currentSelectedIds.includes(b.user?.id || '');
        
        // 已选中的排在前面
        if (aChecked && !bChecked) return -1;
        if (!aChecked && bChecked) return 1;
        
        // 相同选中状态下，按邮箱排序
        const aEmail = (a.user?.email || '').toLowerCase();
        const bEmail = (b.user?.email || '').toLowerCase();
        return aEmail.localeCompare(bEmail);
      });
      setSortedMembers(sorted);
    } else if (!selectOpen) {
      // 关闭时清空排序列表
      setSortedMembers([]);
    }
  }, [selectOpen, members]); // 不包含 selectedMemberIds，避免点击时重新排序


  return (
    <>
      <Card className="shadow-none flex-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconList />
            分组
          </CardTitle>
          <CardDescription>
            团队分组列表
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => setAddGroupDialogOpen(true)}>
              <IconCirclePlus />
              添加分组
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
                      {group.users?.length || 0} 个成员
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
                          修改名称
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEditGroupMembers(group)}>
                          <IconUserPlus />
                          调整成员
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive" 
                          onClick={() => handleDeleteGroup(group)}
                        >
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

      <Dialog open={addGroupDialogOpen} onOpenChange={setAddGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加分组</DialogTitle>
            <DialogDescription>
              请输入分组名称
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>分组名称</FieldLabel>
              <FieldContent>
                <Input
                  placeholder="请输入分组名称"
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
              取消
            </Button>
            <Button onClick={handleAddGroup} disabled={!groupName.trim() || submitting}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除分组</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除分组 "{deletingGroupName}" 吗？此操作不可恢复。
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

      <Dialog open={editGroupDialogOpen} onOpenChange={setEditGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改名称</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>分组名称</FieldLabel>
              <FieldContent>
                <Input
                  placeholder="请输入分组名称"
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
              取消
            </Button>
            <Button onClick={handleUpdateGroup} disabled={!editingGroupName.trim() || updating}>
              {updating ? "更新中..." : "更新"}
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
            <DialogTitle>调整成员 - {editingGroupMembersName}</DialogTitle>
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
                        ? "请选择成员"
                        : selectedMemberIds.length === 1
                        ? members.find((m) => m.user?.id === selectedMemberIds[0])?.user?.name || "已选择 1 个成员"
                        : `已选择 ${selectedMemberIds.length} 个成员`}
                    </span>
                    <IconChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                  </Button>
                  {selectOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                      <div className="max-h-[300px] overflow-auto p-1">
                        {sortedMembers.length === 0 ? (
                          <div className="py-6 text-center text-sm text-muted-foreground">
                            暂无成员
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
                                  <AvatarImage src={member.user?.avatar_url || "/logo-colored.png"} />
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
              取消
            </Button>
            <Button onClick={handleSaveGroupMembers} disabled={savingMembers}>
              {savingMembers ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewMembersDialogOpen} onOpenChange={setViewMembersDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{viewingGroup?.name} - 成员列表</DialogTitle>
            <DialogDescription>
              共 {viewingGroupMembers.length} 个成员
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {viewingGroupMembers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                该分组暂无成员
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
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

