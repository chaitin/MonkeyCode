import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Box, Clock3, MoreVertical, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { toast } from "sonner";
import { TaskflowVirtualMachineStatus, type DomainHost, type DomainTeamGroup, type DomainTeamTaskVMIdlePolicy, type DomainVirtualMachine } from "@/api/Api";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import EditHost from "@/components/manager/edit-host";
import { formatMemory, getHostStatusBadge } from "@/utils/common";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

const secondsToHours = (seconds?: number) => {
  if (!seconds) {
    return ""
  }
  return String(Math.round((seconds / 3600) * 100) / 100)
}

const hoursToSeconds = (hours: string) => {
  const value = Number(hours)
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.round(value * 3600)
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const formatPolicyDuration = (seconds: number | undefined, t: Translate) => {
  if (!seconds) {
    return t("managerHosts.policy.notConfigured")
  }
  const hours = seconds / 3600
  return t("managerHosts.policy.hours", {
    count: Number.isInteger(hours) ? hours : Math.round(hours * 100) / 100,
  })
}

function PolicySummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={value}>
        {value}
      </div>
    </div>
  )
}

export default function TeamManagerHosts() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<string>("")
  const [hosts, setHosts] = useState<DomainHost[]>([])
  const [loadingInstallCommand, setLoadingInstallCommand] = useState(false)
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [removingHost, setRemovingHost] = useState(false)
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<DomainHost | null>(null)
  const [policy, setPolicy] = useState<DomainTeamTaskVMIdlePolicy | null>(null)
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false)
  const [loadingPolicy, setLoadingPolicy] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [sleepEnabled, setSleepEnabled] = useState(true)
  const [sleepHours, setSleepHours] = useState("")
  const [recycleEnabled, setRecycleEnabled] = useState(true)
  const [recycleHours, setRecycleHours] = useState("")
  const [taskConcurrencyLimit, setTaskConcurrencyLimit] = useState("3")
  const errorMessage = (message?: string) => message || t("managerShell.common.unknownError")
  


  const fetchHosts = async () => {
    setLoadingHosts(true)
    await apiRequest('v1TeamsHostsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setHosts(resp.data.hosts || [])
      } else {
        toast.error(t("managerHosts.toast.fetchHostsFailed", { message: errorMessage(resp.message) }))
      }
    })
    setLoadingHosts(false)
  }

  const syncPolicyForm = (nextPolicy: DomainTeamTaskVMIdlePolicy) => {
    setPolicy(nextPolicy)
    setSleepEnabled(nextPolicy.sleep_enabled ?? true)
    setSleepHours(secondsToHours(nextPolicy.sleep_seconds))
    setRecycleEnabled(nextPolicy.recycle_enabled ?? true)
    setRecycleHours(secondsToHours(nextPolicy.recycle_seconds))
    setTaskConcurrencyLimit(String(nextPolicy.task_concurrency_limit ?? 3))
  }

  const fetchPolicy = async () => {
    setLoadingPolicy(true)
    await apiRequest('v1TeamsTaskVmIdlePolicyList', {}, [], (resp) => {
      if (resp.code === 0 && resp.data) {
        syncPolicyForm(resp.data)
      } else {
        toast.error(t("managerHosts.toast.fetchPolicyFailed", { message: errorMessage(resp.message) }))
      }
    })
    setLoadingPolicy(false)
  }

  const fetchInstallCommand = async () => {
    setLoadingInstallCommand(true)
    await apiRequest('v1TeamsHostsInstallCommandList', {}, [], (resp) => {
      if (resp.code === 0) {
        setCommand(resp.data.command || "")
      } else {
        toast.error(t("managerHosts.toast.fetchInstallCommandFailed", { message: errorMessage(resp.message) }))
      }
    })
    setLoadingInstallCommand(false)
  }

  useEffect(() => {
    if (open) {
      fetchInstallCommand()
    }
  }, [open])

  useEffect(() => {
    fetchHosts()
    fetchPolicy()
  }, [])

  const handleSavePolicy = async () => {
    const parsedTaskConcurrencyLimit = Number(taskConcurrencyLimit)
    if (!Number.isInteger(parsedTaskConcurrencyLimit) || parsedTaskConcurrencyLimit <= 0) {
      toast.error(t("managerHosts.toast.invalidConcurrency"))
      return
    }

    setSavingPolicy(true)
    await apiRequest('v1TeamsTaskVmIdlePolicyUpdate', {
      task_concurrency_limit: parsedTaskConcurrencyLimit,
      sleep_enabled: sleepEnabled,
      sleep_seconds: hoursToSeconds(sleepHours),
      recycle_enabled: recycleEnabled,
      recycle_seconds: hoursToSeconds(recycleHours),
    }, [], (resp) => {
      if (resp.code === 0 && resp.data) {
        syncPolicyForm(resp.data)
        toast.success(t("managerHosts.toast.policySaved"))
      } else {
        toast.error(t("managerHosts.toast.savePolicyFailed", { message: errorMessage(resp.message) }))
      }
    })
    setSavingPolicy(false)
  }

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success(t("managerHosts.toast.commandCopied"))
    } catch (error) {
      toast.error(t("managerHosts.toast.copyFailed"))
      console.error("Copy command failed:", error)
    }
  }

  const handleDeleteHost = async (hostId: string) => {
    setRemovingHost(true)
    await apiRequest('v1TeamsHostsDelete', {}, [hostId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerHosts.toast.hostRemoved"))
        fetchHosts()
      } else {
        toast.error(t("managerHosts.toast.removeHostFailed", { message: errorMessage(resp.message) }))
      }
    })
    setRemovingHost(false)
  }

  const handleEdit = (host: DomainHost) => {
    setEditingHost(host)
    setIsEditDialogOpen(true)
  }

  const handleEditCancel = () => {
    setEditingHost(null)
    setIsEditDialogOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 />
            {t("managerHosts.policy.title")}
          </CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setPolicyDialogOpen(true)}>
              {t("managerHosts.actions.configure")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loadingPolicy ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner className="size-6" />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <PolicySummaryItem
                label={t("managerHosts.policy.concurrency")}
                value={t("managerHosts.policy.taskCount", { count: policy?.task_concurrency_limit ?? 3 })}
              />
              <PolicySummaryItem
                label={t("managerHosts.policy.autoSleep")}
                value={sleepEnabled ? t("managerHosts.policy.afterSleep", { duration: formatPolicyDuration(policy?.effective_sleep_seconds, t) }) : t("managerHosts.policy.disabled")}
              />
              <PolicySummaryItem
                label={t("managerHosts.policy.autoRecycle")}
                value={recycleEnabled ? t("managerHosts.policy.afterRecycle", { duration: formatPolicyDuration(policy?.effective_recycle_seconds, t) }) : t("managerHosts.policy.disabled")}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("managerHosts.policy.title")}</DialogTitle>
          </DialogHeader>
          {loadingPolicy ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner className="size-6" />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor="task-concurrency-limit">{t("managerHosts.policy.concurrency")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("managerHosts.policy.concurrencyDescription")}
                    </p>
                  </div>
                  <div className="mt-4 space-y-2">
                    <Input
                      id="task-concurrency-limit"
                      type="number"
                      min="1"
                      step="1"
                      value={taskConcurrencyLimit}
                      onChange={(e) => setTaskConcurrencyLimit(e.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="task-vm-sleep-enabled">{t("managerHosts.policy.autoSleep")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("managerHosts.policy.sleepDescription")}
                      </p>
                    </div>
                    <Switch
                      id="task-vm-sleep-enabled"
                      checked={sleepEnabled}
                      onCheckedChange={setSleepEnabled}
                    />
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label htmlFor="task-vm-sleep-hours">{t("managerHosts.policy.sleepHours")}</Label>
                    <Input
                      id="task-vm-sleep-hours"
                      type="number"
                      min="0"
                      step="0.5"
                      value={sleepHours}
                      disabled={!sleepEnabled}
                      placeholder={policy?.sleep_inherited ? t("managerHosts.policy.inheritDefault", { duration: formatPolicyDuration(policy.effective_sleep_seconds, t) }) : t("managerHosts.policy.inheritGlobalDefault")}
                      onChange={(e) => setSleepHours(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("managerHosts.policy.effectiveHint", { value: sleepEnabled ? formatPolicyDuration(policy?.effective_sleep_seconds, t) : t("managerHosts.policy.disabled") })}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="task-vm-recycle-enabled">{t("managerHosts.policy.autoRecycle")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("managerHosts.policy.recycleDescription")}
                      </p>
                    </div>
                    <Switch
                      id="task-vm-recycle-enabled"
                      checked={recycleEnabled}
                      onCheckedChange={setRecycleEnabled}
                    />
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label htmlFor="task-vm-recycle-hours">{t("managerHosts.policy.recycleHours")}</Label>
                    <Input
                      id="task-vm-recycle-hours"
                      type="number"
                      min="0"
                      step="0.5"
                      value={recycleHours}
                      disabled={!recycleEnabled}
                      placeholder={policy?.recycle_inherited ? t("managerHosts.policy.inheritDefault", { duration: formatPolicyDuration(policy.effective_recycle_seconds, t) }) : t("managerHosts.policy.inheritGlobalDefault")}
                      onChange={(e) => setRecycleHours(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("managerHosts.policy.effectiveHint", { value: recycleEnabled ? formatPolicyDuration(policy?.effective_recycle_seconds, t) : t("managerHosts.policy.disabled") })}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSavePolicy} disabled={savingPolicy || loadingPolicy}>
                  {savingPolicy ? <Spinner className="size-4" /> : <Save className="size-4" />}
                  {t("managerHosts.actions.save")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box />
            {t("managerHosts.hosts.title")}
          </CardTitle>
          <CardDescription>
            {t("managerHosts.hosts.description")}
          </CardDescription>
          <CardAction>
            <Button variant={"outline"} size="sm" onClick={() => setOpen(true)}>{t("managerHosts.bind.title")}</Button>
          </CardAction>
        </CardHeader>
        <CardContent>

        {loadingHosts ? (
          <Empty className="bg-muted">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="flex flex-col gap-4">
            {hosts.map((host) => (
              <Item key={host.id} variant="outline" className="hover:border-primary/30" size="sm">
                <ItemContent>
                  <ItemTitle className="break-all">
                    {host.remark || `${host.name}-${host.external_ip}`}
                    {getHostStatusBadge(host.status)}
                    <Badge variant="secondary" className="hidden sm:inline">{t("managerHosts.hosts.cores", { count: host.cores })}</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{formatMemory(host.memory)}</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{host.arch}</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{host.external_ip}</Badge>
                  </ItemTitle>
                  <ItemDescription className="hidden md:block">
                    {t("managerHosts.hosts.vmSummary", {
                      total: host.virtualmachines?.length || 0,
                      active: host.virtualmachines?.filter((vm: DomainVirtualMachine) => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).length || 0,
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(host)}>
                        <IconPencil />
                        {t("managerHosts.actions.edit")}
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem 
                            className="text-destructive" 
                            onSelect={(e) => { e.preventDefault() }}
                          >
                            <IconTrash />
                            {t("managerHosts.actions.remove")}
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("managerHosts.dialogs.remove.title")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("managerHosts.dialogs.remove.description", { name: host.remark || `${host.name}-${host.external_ip}` })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteHost(host.id!)} disabled={removingHost}>
                              {t("managerHosts.dialogs.remove.confirm")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
                <ItemFooter className="flex flex-col gap-2 items-start">
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {host.groups && host.groups.length > 0 ? host.groups?.map((group: DomainTeamGroup) => (
                      <Badge variant="outline" key={group.id}>{group.name}</Badge>
                    )) : (
                      <div className="text-sm text-muted-foreground">{t("managerHosts.hosts.noGroups")}</div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {host.virtualmachines?.filter(vm => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).map(vm => (
                      <Badge variant="outline" key={vm.id}>
                        {t("managerHosts.hosts.vmBadge", { email: vm.owner?.email, cores: vm.cores, memory: formatMemory(vm.memory) })}
                      </Badge>
                    ))}
                  </div>
                </ItemFooter>
              </Item>)
            )}
          </ItemGroup>
        )}
        </CardContent>
        <EditHost
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleEditCancel()
            }
          }}
          host={editingHost ? { id: editingHost.id || '', name: editingHost.name || '', external_ip: editingHost.external_ip || '', remark: editingHost.remark || '', groups: editingHost.groups } : null}
          onRefresh={fetchHosts}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("managerHosts.bind.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("managerHosts.bind.description")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <pre
                  className="bg-muted p-4 rounded-md whitespace-pre-wrap break-words text-sm cursor-pointer hover:text-success"
                  onClick={handleCopyCommand}
                >
                  <code className="code-font">{loadingInstallCommand ? t("managerHosts.bind.generatingCommand") : command}</code>
                </pre>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("managerHosts.bind.copyCommand")}</p>
              </TooltipContent>
            </Tooltip>
            <p className="text-sm text-muted-foreground">
              {t("managerHosts.bind.afterRun")}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
