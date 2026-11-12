import { useMemo, useState, type FormEvent } from "react"
import {
  BookOpenTextIcon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { AuthorizationSelect } from "@/components/authorization-select"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { ResourceList } from "@/components/resource-list"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { SkillTagSelect } from "@/components/skill-tag-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useResourceList } from "@/hooks/use-resource-list"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { api } from "@/lib/api"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { type AuthorizationSelection } from "@/lib/authorization-groups"
import {
  base,
  grants,
  localized,
  match,
  selection,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { getCreatorInitial } from "@/lib/utils"

type Kb = ResourceRow & {
  document_count: number
  learned_count: number
  embedding_model_id: string | null
  embedding_dimension: number | null
  capabilities?: {
    search_modes: string[]
    channels: string[]
    embedding_configured: boolean
  }
}

function toKb(row: ResourceRow): Kb {
  return row as Kb
}

function toSearchableKb(kb: Kb, language: string) {
  const text = localized(kb, language)
  return {
    ...kb,
    name: text.name,
    description: text.description,
  }
}

export function KbPage() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { tags: availableTags } = useSkillTags()
  const subjects = useSubjects()
  const remote = useResourceList<Kb>("/kb")
  const knowledgeBases = useMemo(
    () =>
      remote.items.map((item) => ({
        ...toKb(item),
        ...toSearchableKb(toKb(item), i18n.language),
      })),
    [i18n.language, remote.items]
  )

  const [kbDialogOpen, setKbDialogOpen] = useState(false)
  const [editingKbId, setEditingKbId] = useState<string | null>(null)
  const [kbPendingDeletion, setKbPendingDeletion] = useState<Kb | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const editingKb = knowledgeBases.find((item) => item.id === editingKbId)
  const resetKbOptions = () => {
    setTagsOpen(false)
    setSelectedTagIds([])
    setAuthorization({ groupIds: [], memberIds: [] })
  }

  const handleKbDialogOpenChange = (open: boolean) => {
    setKbDialogOpen(open)
    if (!open) {
      setEditingKbId(null)
      resetKbOptions()
    }
  }

  const handleEditKb = (kb: Kb) => {
    if (kb.ownership_type !== "system") return
    setEditingKbId(kb.id)
    setSelectedTagIds((kb.tags ?? []).map((tag) => tag.id))
    setAuthorization(selection(kb.grants))
    setTagsOpen(false)
    setKbDialogOpen(true)
  }

  const handleSubmitKb = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const tagIds = selectedTagIds.filter((tagId) =>
      availableTags.some((tag) => tag.id === tagId)
    )
    if (!name) return

    await remote.run(async () => {
      const payload = {
        name,
        description,
        tag_ids: tagIds,
        grants: grants(authorization),
      }
      if (!editingKb) {
        await api<ResourceRow>(`${base}/kb`, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      } else {
        await api<ResourceRow>(`${base}/kb/${editingKb.id}`, {
          method: "PUT",
          headers: match(editingKb.revision),
          body: JSON.stringify(payload),
        })
      }
      form.reset()
      handleKbDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }

  const handleDeleteKb = async () => {
    if (!kbPendingDeletion) return
    await remote.run(async () => {
      await api(`${base}/kb/${kbPendingDeletion.id}`, {
        method: "DELETE",
        headers: match(kbPendingDeletion.revision),
      })
      setKbPendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  const setKbEnabled = async (kb: Kb, enabled: boolean) => {
    await remote.run(async () => {
      await api(`${base}/kb/${kb.id}/enabled`, {
        method: "PATCH",
        headers: match(kb.revision),
        body: JSON.stringify({ enabled }),
      })
    }, t("resources.operationCompleted"))
  }

  const renderList = () => (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={remote}
        typeLabel={t("pages.knowledgeBases.type")}
        systemLabel={t("pages.knowledgeBases.systemKnowledgeBase")}
        userLabel={t("pages.knowledgeBases.userKnowledgeBase")}
        actions={
          remote.type === "system" ? (
            <Dialog open={kbDialogOpen} onOpenChange={handleKbDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    className="ms-auto shrink-0"
                    onClick={() => {
                      setEditingKbId(null)
                      resetKbOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.knowledgeBases.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
              >
                <form
                  key={editingKb?.id ?? "new-kb"}
                  className="flex min-w-0 flex-col gap-6"
                  onSubmit={handleSubmitKb}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {editingKb
                        ? t("pages.knowledgeBases.editDialogTitle")
                        : t("pages.knowledgeBases.dialogTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("pages.knowledgeBases.dialogDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="kb-name">
                        {t("pages.knowledgeBases.name")}
                      </FieldLabel>
                      <Input
                        id="kb-name"
                        name="name"
                        defaultValue={editingKb?.name}
                        placeholder={t("pages.knowledgeBases.namePlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-description">
                        {t("pages.knowledgeBases.knowledgeDescription")}
                      </FieldLabel>
                      <Textarea
                        className="max-h-48 min-h-28 min-w-0 resize-y overflow-y-auto [overflow-wrap:anywhere]"
                        id="kb-description"
                        name="description"
                        defaultValue={editingKb?.description}
                        placeholder={t(
                          "pages.knowledgeBases.descriptionPlaceholder"
                        )}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-authorized-users">
                        {t("pages.models.authorizedScope")}
                      </FieldLabel>
                      <AuthorizationSelect
                        groups={subjects.groups}
                        members={subjects.members}
                        id="kb-authorized-users"
                        disabled={remote.pending}
                        value={authorization}
                        onValueChange={setAuthorization}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-tags">
                        {t("pages.knowledgeBases.tags")}
                      </FieldLabel>
                      <SkillTagSelect
                        id="kb-tags"
                        open={tagsOpen}
                        options={availableTags}
                        placeholder={t("pages.knowledgeBases.tagsPlaceholder")}
                        value={selectedTagIds}
                        onOpenChange={setTagsOpen}
                        onValueChange={setSelectedTagIds}
                      />
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.knowledgeBases.cancel")}
                    </DialogClose>
                    <Button type="submit">
                      {editingKb
                        ? t("pages.knowledgeBases.save")
                        : t("pages.knowledgeBases.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {knowledgeBases.map((kb) => (
            <ResourceCard
              key={kb.id}
              disabled={!kb.enabled}
              selectable
              className="cursor-pointer"
              onClick={() => navigate(`${CONSOLE_ROUTES.kb}/${kb.id}`)}
            >
              <CardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar size="lg">
                    <AvatarFallback
                      className={
                        kb.ownership_type === "user"
                          ? "text-lg font-normal"
                          : undefined
                      }
                    >
                      {kb.ownership_type === "system" ? (
                        <HugeiconsIcon
                          icon={BookOpenTextIcon}
                          strokeWidth={2}
                        />
                      ) : (
                        getCreatorInitial(kb.user?.name || kb.user?.email || "")
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{kb.name}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("pages.knowledgeBases.contentCount", {
                          count: kb.document_count ?? 0,
                        })}
                        {" · "}
                        {t("pages.knowledgeBases.learnedCount", {
                          learned: kb.learned_count ?? 0,
                          total: kb.document_count ?? 0,
                        })}
                      </p>
                    </div>
                    {kb.ownership_type === "system" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ResourceCardMenuButton
                              aria-label={t("common.more")}
                              onClick={(event) => event.stopPropagation()}
                            />
                          }
                        >
                          <HugeiconsIcon icon={MoreHorizontalIcon} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => navigate(`${CONSOLE_ROUTES.kb}/${kb.id}`)}>
                              <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
                              {t("pages.knowledgeBases.viewContents")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void setKbEnabled(kb, !kb.enabled)}
                            >
                              <HugeiconsIcon
                                icon={kb.enabled ? PauseIcon : PlayIcon}
                                strokeWidth={2}
                              />
                              {kb.enabled
                                ? t("pages.knowledgeBases.disable")
                                : t("pages.knowledgeBases.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEditKb(kb)}>
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.knowledgeBases.editInfo")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setKbPendingDeletion(kb)}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.knowledgeBases.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p
                  className="line-clamp-2 min-h-10 text-muted-foreground"
                  title={kb.description}
                >
                  {kb.description?.trim() || t("resources.noDescription")}
                </p>
              </CardContent>
              <CardFooter className="min-w-0 border-t">
                <ResourceTagSummary
                  tagIds={(kb.tags ?? []).map((tag) => tag.id)}
                />
              </CardFooter>
            </ResourceCard>
          ))}
        </div>
      </ResourceList>
    </section>
  )

  return (
    <>
      {renderList()}
      <AlertDialog
        open={kbPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setKbPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.knowledgeBases.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.knowledgeBases.deleteDialogDescription", {
              knowledgeBase: kbPendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.knowledgeBases.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDeleteKb()}
            >
              {t("pages.knowledgeBases.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

