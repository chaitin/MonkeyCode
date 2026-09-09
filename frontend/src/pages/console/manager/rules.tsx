import { useEffect, useState } from "react"
import { FileText, History, MoreVertical, Plus } from "lucide-react"
import { IconPencil, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import type {
  GithubComChaitinMonkeyCodeBackendDomainTeamRule as DomainTeamRule,
  GithubComChaitinMonkeyCodeBackendDomainTeamRuleVersion as DomainTeamRuleVersion,
} from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { apiRequest } from "@/utils/requestUtils"

interface ManagedRule {
  id: string
  name: string
  description: string
  content: string
  enabled: boolean
  activeVersion?: string
  updatedAt: number
}

function toManagedRule(rule: DomainTeamRule): ManagedRule {
  return {
    id: rule.id || "",
    name: rule.name || "",
    description: rule.description || "",
    content: rule.content || "",
    enabled: Boolean(rule.enabled),
    activeVersion: rule.active_version,
    updatedAt: rule.updated_at || 0,
  }
}


function formatRuleVersionTime(value: number | undefined, language: string): string {
  if (!value) return ""
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return new Date(value * 1000).toLocaleString(locale, { hour12: false }).replace(/\//g, "-")
}

export default function TeamManagerRules() {
  const { t, i18n } = useTranslation()
  const [rules, setRules] = useState<ManagedRule[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedRule | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRule, setHistoryRule] = useState<ManagedRule | null>(null)
  const [historyVersions, setHistoryVersions] = useState<DomainTeamRuleVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restoringId, setRestoringId] = useState("")

  const fetchRules = async () => {
    setLoading(true)
    await apiRequest("v1TeamsRulesList", {}, [], (resp) => {
      if (resp.code === 0) {
        setRules((resp.data?.rules || []).map(toManagedRule))
        return
      }
      toast.error(resp.message || t("managerRules.toast.fetchFailed"))
    })
    setLoading(false)
  }

  useEffect(() => {
    void fetchRules()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setName("")
    setDescription("")
    setContent("")
    setDialogOpen(true)
  }

  const openEdit = (rule: ManagedRule) => {
    setEditing(rule)
    setName(rule.name)
    setDescription(rule.description)
    setContent(rule.content)
    setDialogOpen(true)
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error(t("managerRules.toast.nameRequired"))
      return
    }
    if (!content.trim()) {
      toast.error(t("managerRules.toast.contentRequired"))
      return
    }
    setSubmitting(true)
    if (editing) {
      void apiRequest("v1TeamsRulesUpdate", {
        name: name.trim(),
        description: description.trim(),
        content,
      }, [editing.id], (resp) => {
        setSubmitting(false)
        if (resp.code === 0 && resp.data) {
          const next = toManagedRule(resp.data)
          setRules((prev) => prev.map((item) => (item.id === next.id ? next : item)))
          toast.success(t("managerRules.toast.saved"))
          setDialogOpen(false)
          return
        }
        toast.error(resp.message || t("managerRules.toast.saveFailed"))
      }, () => setSubmitting(false))
      return
    }
    void apiRequest("v1TeamsRulesCreate", {
      name: name.trim(),
      description: description.trim(),
      content,
    }, [], (resp) => {
      setSubmitting(false)
      if (resp.code === 0 && resp.data) {
        setRules((prev) => [toManagedRule(resp.data), ...prev])
        toast.success(t("managerRules.toast.added"))
        setDialogOpen(false)
        return
      }
      toast.error(resp.message || t("managerRules.toast.addFailed"))
    }, () => setSubmitting(false))
  }

  const handleEnabled = (rule: ManagedRule, enabled: boolean) => {
    void apiRequest("v1TeamsRulesEnabledUpdate", { enabled }, [rule.id], (resp) => {
      if (resp.code === 0 && resp.data) {
        const next = toManagedRule(resp.data)
        setRules((prev) => prev.map((item) => (item.id === next.id ? next : item)))
        toast.success(enabled ? t("managerRules.toast.enabled") : t("managerRules.toast.disabled"))
        return
      }
      toast.error(resp.message || t("managerRules.toast.enableFailed"))
    })
  }

  const handleDelete = (ruleID: string) => {
    void apiRequest("v1TeamsRulesDelete", {}, [ruleID], (resp) => {
      if (resp.code === 0) {
        setRules((prev) => prev.filter((rule) => rule.id !== ruleID))
        toast.success(t("managerRules.toast.deleted"))
        return
      }
      toast.error(resp.message || t("managerRules.toast.deleteFailed"))
    })
  }

  const openHistory = (rule: ManagedRule) => {
    setHistoryRule(rule)
    setHistoryVersions([])
    setHistoryOpen(true)
    setHistoryLoading(true)
    void apiRequest("v1TeamsRulesVersionsList", {}, [rule.id], (resp) => {
      setHistoryLoading(false)
      if (resp.code === 0) {
        setHistoryVersions(resp.data?.versions || [])
        return
      }
      toast.error(resp.message || t("managerRules.toast.historyFailed"))
    }, () => setHistoryLoading(false))
  }

  const handleRestore = (versionId: string) => {
    if (!historyRule || !versionId) return
    setRestoringId(versionId)
    void apiRequest("v1TeamsRulesRestoreCreate", { version_id: versionId }, [historyRule.id], (resp) => {
      setRestoringId("")
      if (resp.code === 0 && resp.data) {
        const next = toManagedRule(resp.data)
        setRules((prev) => prev.map((item) => (item.id === next.id ? next : item)))
        setHistoryRule(next)
        toast.success(t("managerRules.toast.restored"))
        return
      }
      toast.error(resp.message || t("managerRules.toast.restoreFailed"))
    }, () => setRestoringId(""))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText />
            {t("managerShell.nav.rules")}
          </CardTitle>
          <CardDescription>{t("managerRules.description")}</CardDescription>
          <CardAction>
            <Button onClick={openCreate}>
              <Plus />
              {t("managerRules.actions.add")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t("managerRules.empty.loading")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : rules.length === 0 ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t("managerRules.empty.title")}</EmptyTitle>
                <EmptyDescription>{t("managerRules.empty.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="flex flex-col gap-4">
              {rules.map((rule) => (
                <Item key={rule.id} variant="outline" className="hover:border-primary/30" size="sm">
                  <ItemContent>
                    <ItemTitle className="break-all">{rule.name}</ItemTitle>
                    <ItemDescription className="line-clamp-2">
                      {rule.description || rule.content}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => handleEnabled(rule, Boolean(checked))}
                      aria-label={rule.enabled ? t("managerRules.actions.disable") : t("managerRules.actions.enable")}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(rule)}>
                          <IconPencil />
                          {t("managerRules.actions.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openHistory(rule)}>
                          <History className="size-4" />
                          {t("managerRules.actions.history")}
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={(event) => event.preventDefault()}
                            >
                              <IconTrash />
                              {t("managerRules.actions.delete")}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("managerRules.dialogs.delete.title")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("managerRules.dialogs.delete.description", { name: rule.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(rule.id)}>
                                {t("managerRules.dialogs.delete.confirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                  <ItemFooter className="flex flex-col items-start gap-2">
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={rule.enabled ? "secondary" : "outline"}>
                        {rule.enabled ? t("managerRules.status.enabled") : t("managerRules.status.disabled")}
                      </Badge>
                      {rule.activeVersion ? <Badge variant="outline">{rule.activeVersion}</Badge> : null}
                    </div>
                  </ItemFooter>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("managerRules.dialogs.edit.title") : t("managerRules.dialogs.add.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("managerRules.fields.name")}</FieldLabel>
              <FieldContent>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("managerRules.fields.description")}</FieldLabel>
              <FieldContent>
                <Input value={description} onChange={(event) => setDescription(event.target.value)} />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("managerRules.fields.content")}</FieldLabel>
              <FieldContent>
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={t("managerRules.fields.contentPlaceholder")}
                  className="min-h-40"
                />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {t("managerShell.common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {editing ? t("managerRules.actions.save") : t("managerRules.actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("managerRules.dialogs.history.title", { name: historyRule?.name || "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {t("managerRules.dialogs.history.description")}
            </p>
            {historyLoading ? (
              <Empty className="bg-muted">
                <EmptyHeader>
                  <EmptyTitle>{t("managerRules.empty.historyLoading")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : historyVersions.length === 0 ? (
              <Empty className="bg-muted">
                <EmptyHeader>
                  <EmptyTitle>{t("managerRules.empty.historyTitle")}</EmptyTitle>
                  <EmptyDescription>{t("managerRules.empty.historyDescription")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {historyVersions.map((version) => {
                  const versionId = version.id || ""
                  const isActive = Boolean(version.version) && version.version === historyRule?.activeVersion
                  return (
                    <Item key={versionId || version.version} variant="outline" size="sm">
                      <ItemContent>
                        <ItemTitle className="font-mono text-sm">{version.version}</ItemTitle>
                        <ItemDescription>
                          {formatRuleVersionTime(version.created_at, i18n.language)}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        {isActive ? (
                          <Badge variant="secondary">{t("managerRules.status.activeVersion")}</Badge>
                        ) : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" disabled={Boolean(restoringId)}>
                                {t("managerRules.actions.restore")}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("managerRules.dialogs.restore.title")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("managerRules.dialogs.restore.description", { version: version.version })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={restoringId === versionId}
                                  onClick={() => handleRestore(versionId)}
                                >
                                  {t("managerRules.dialogs.restore.confirm")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </ItemActions>
                    </Item>
                  )
                })}
              </ItemGroup>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {t("managerShell.common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
