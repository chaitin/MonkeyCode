import { useRef, useState, type ChangeEvent } from "react"
import {
  ArrowDown01Icon,
  DocumentValidationIcon,
  FileArchiveIcon,
  FolderOpenIcon,
  Tick02Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { AuthorizationSelect } from "@/components/authorization-select"
import { SkillTagSelect } from "@/components/skill-tag-select"
import type { SkillTag } from "@/lib/skill-tags"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import type { AuthorizationSelection } from "@/lib/authorization-groups"
import {
  inspectSkillArchive,
  inspectSkillDirectory,
  SkillPackageError,
  type SkillPackageAnalysis,
} from "@/lib/skill-package"
import { cn } from "@/lib/utils"

type WizardStep = "source" | "select"

type ImportSource =
  | {
      type: "archives"
      files: File[]
    }
  | {
      type: "directory"
      files: File[]
    }

type ImportCandidate = {
  id: string
  sourceName: string
  analysis: SkillPackageAnalysis
}

type SkillImportValue = {
  analysis: SkillPackageAnalysis
  sourceName: string
  tagIds: string[]
  authorization: AuthorizationSelection
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SkillImportWizard({
  availableTags,
  onImport,
}: {
  availableTags: SkillTag[]
  onImport: (values: SkillImportValue[]) => void
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>("source")
  const [source, setSource] = useState<ImportSource | null>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sourceError, setSourceError] = useState("")
  const [scanWarnings, setScanWarnings] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: ["all-members"],
    memberIds: [],
  })
  const requestId = useRef(0)
  const archiveInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputRef = useRef<HTMLInputElement | null>(null)

  const getErrorMessage = (error: unknown) => {
    const errorKey =
      error instanceof SkillPackageError ? error.code : "invalidZip"
    return t(`pages.skills.packageErrors.${errorKey}`)
  }

  const applyScanResults = (
    analyses: Array<{ sourceName: string; analysis: SkillPackageAnalysis }>,
    warnings: string[]
  ) => {
    const nextCandidates = analyses.map(({ sourceName, analysis }, index) => ({
      id: `${sourceName}-${analysis.entryPath}-${index}`,
      sourceName,
      analysis,
    }))

    if (nextCandidates.length === 0) {
      setSourceError(warnings[0] ?? t("pages.skills.batchImport.noSkillsFound"))
      setScanWarnings([])
      return
    }

    setCandidates(nextCandidates)
    setSelectedIds(nextCandidates.map((candidate) => candidate.id))
    setSourceError("")
    setScanWarnings(warnings)
    setStep("select")
  }

  const resetScanResults = () => {
    requestId.current += 1
    setCandidates([])
    setSelectedIds([])
    setScanWarnings([])
    setSourceError("")
  }

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    if (files.length === 0) {
      resetScanResults()
      setSource(null)
      return
    }

    resetScanResults()
    setSource({ type: "archives", files })
    if (directoryInputRef.current) {
      directoryInputRef.current.value = ""
    }
  }

  const handleDirectoryChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    if (files.length === 0) {
      resetScanResults()
      setSource(null)
      return
    }

    resetScanResults()
    setSource({ type: "directory", files })
    if (archiveInputRef.current) {
      archiveInputRef.current.value = ""
    }
  }

  const handleNext = async () => {
    if (!source) {
      return
    }

    const currentRequestId = requestId.current + 1
    requestId.current = currentRequestId
    setScanning(true)
    setSourceError("")

    if (source.type === "directory") {
      try {
        const analyses = await inspectSkillDirectory(source.files)
        if (currentRequestId !== requestId.current) {
          return
        }
        const firstPath =
          source.files[0].webkitRelativePath || source.files[0].name
        const sourceName = firstPath.split("/")[0]
        applyScanResults(
          analyses.map((analysis) => ({ sourceName, analysis })),
          []
        )
      } catch (error) {
        if (currentRequestId === requestId.current) {
          setSourceError(getErrorMessage(error))
        }
      } finally {
        if (currentRequestId === requestId.current) {
          setScanning(false)
        }
      }
      return
    }

    const validFiles = source.files.filter((file) =>
      file.name.toLocaleLowerCase().endsWith(".zip")
    )
    const warnings = source.files
      .filter((file) => !validFiles.includes(file))
      .map(
        (file) => `${file.name}: ${t("pages.skills.packageErrors.invalidZip")}`
      )
    const settledResults = await Promise.allSettled(
      validFiles.map(async (file) => ({
        file,
        analyses: await inspectSkillArchive(file),
      }))
    )

    if (currentRequestId !== requestId.current) {
      return
    }

    const analyses: Array<{
      sourceName: string
      analysis: SkillPackageAnalysis
    }> = []
    settledResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        analyses.push(
          ...result.value.analyses.map((analysis) => ({
            sourceName: result.value.file.name,
            analysis,
          }))
        )
      } else {
        warnings.push(
          `${validFiles[index].name}: ${getErrorMessage(result.reason)}`
        )
      }
    })

    if (currentRequestId === requestId.current) {
      applyScanResults(analyses, warnings)
      setScanning(false)
    }
  }

  const selectedCandidates = candidates.filter((candidate) =>
    selectedIds.includes(candidate.id)
  )
  const allSelected =
    candidates.length > 0 && selectedIds.length === candidates.length
  const authorizationIsEmpty =
    authorization.groupIds.length + authorization.memberIds.length === 0
  const sourceName =
    source?.type === "archives"
      ? source.files.map((file) => file.name).join(", ")
      : source?.type === "directory"
        ? (source.files[0].webkitRelativePath || source.files[0].name).split(
            "/"
          )[0]
        : ""

  const setCandidateChecked = (candidateId: string, checked: boolean) => {
    setSelectedIds((currentIds) =>
      checked
        ? [...currentIds, candidateId]
        : currentIds.filter((id) => id !== candidateId)
    )
  }

  const handleImport = () => {
    if (selectedCandidates.length === 0 || authorizationIsEmpty) {
      return
    }

    onImport(
      selectedCandidates.map((candidate) => ({
        analysis: candidate.analysis,
        sourceName: candidate.sourceName,
        tagIds: selectedTagIds,
        authorization,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>{t("pages.skills.dialogTitle")}</DialogTitle>
      </DialogHeader>

      <ol aria-label={t("pages.skills.dialogTitle")} className="flex w-full">
        <li
          aria-current={step === "source" ? "step" : undefined}
          className="flex flex-1 flex-col items-center gap-2"
        >
          <div className="flex w-full items-center">
            <span aria-hidden="true" className="flex-1" />
            <Badge className="size-6 p-0" variant="default">
              {step === "select" ? (
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              ) : (
                "1"
              )}
            </Badge>
            <Separator className="w-auto flex-1" />
          </div>
          <span className="text-xs">
            {t("pages.skills.batchImport.sourceStep")}
          </span>
        </li>
        <li
          aria-current={step === "select" ? "step" : undefined}
          className="flex flex-1 flex-col items-center gap-2"
        >
          <div className="flex w-full items-center">
            <Separator className="w-auto flex-1" />
            <Badge
              className="size-6 p-0"
              variant={step === "select" ? "default" : "outline"}
            >
              2
            </Badge>
            <span aria-hidden="true" className="flex-1" />
          </div>
          <span
            className={cn(
              "text-xs",
              step === "source" && "text-muted-foreground"
            )}
          >
            {t("pages.skills.batchImport.selectStep")}
          </span>
        </li>
      </ol>

      {step === "source" ? (
        <div>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(sourceError)}>
              <FieldLabel>{t("pages.skills.skillPackage")}</FieldLabel>
              <Input
                accept=".zip,application/zip"
                aria-invalid={Boolean(sourceError)}
                className="hidden"
                disabled={scanning}
                id="skill-archives"
                multiple
                ref={archiveInputRef}
                type="file"
                onChange={handleArchiveChange}
              />
              <Input
                aria-invalid={Boolean(sourceError)}
                className="hidden"
                disabled={scanning}
                id="skill-directory"
                multiple
                ref={(input) => {
                  if (input) {
                    input.setAttribute("webkitdirectory", "")
                    input.setAttribute("directory", "")
                  }
                  directoryInputRef.current = input
                }}
                type="file"
                onChange={handleDirectoryChange}
              />
              <Item variant="outline">
                <ItemContent className="min-w-0">
                  <ItemTitle title={sourceName || undefined}>
                    {sourceName ||
                      `${t("pages.skills.batchImport.archives")} / ${t(
                        "pages.skills.batchImport.directory"
                      )}`}
                  </ItemTitle>
                  <ItemDescription>
                    {source?.type === "archives"
                      ? t("pages.skills.batchImport.archivesHint")
                      : source?.type === "directory"
                        ? t("pages.skills.batchImport.directoryHint")
                        : `${t("pages.skills.batchImport.archivesHint")} ${t(
                            "pages.skills.batchImport.directoryHint"
                          )}`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          disabled={scanning}
                          type="button"
                          variant="outline"
                        />
                      }
                    >
                      <HugeiconsIcon
                        data-icon="inline-start"
                        icon={Upload04Icon}
                      />
                      {t("pages.skills.batchImport.upload")}
                      <HugeiconsIcon
                        data-icon="inline-end"
                        icon={ArrowDown01Icon}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          closeOnClick
                          onClick={() => archiveInputRef.current?.click()}
                        >
                          <HugeiconsIcon icon={FileArchiveIcon} />
                          {t("pages.skills.batchImport.archives")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          closeOnClick
                          onClick={() => directoryInputRef.current?.click()}
                        >
                          <HugeiconsIcon icon={FolderOpenIcon} />
                          {t("pages.skills.batchImport.directory")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
              <FieldError>{sourceError}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.skills.cancel")}
            </DialogClose>
            <Button
              disabled={!source || scanning}
              type="button"
              onClick={handleNext}
            >
              {scanning
                ? t("pages.skills.packageParsing")
                : t("pages.skills.batchImport.next")}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div>
          <FieldGroup className="gap-5">
            <Field data-invalid={scanWarnings.length > 0}>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="select-all-skills">
                  {t("pages.skills.batchImport.found", {
                    count: candidates.length,
                  })}
                </FieldLabel>
                <label
                  className="flex cursor-pointer items-center gap-2"
                  htmlFor="select-all-skills"
                >
                  <Checkbox
                    checked={allSelected}
                    id="select-all-skills"
                    indeterminate={selectedIds.length > 0 && !allSelected}
                    onCheckedChange={(checked) => {
                      setSelectedIds(
                        checked
                          ? candidates.map((candidate) => candidate.id)
                          : []
                      )
                    }}
                  />
                  <span>{t("pages.skills.batchImport.selectAll")}</span>
                </label>
              </div>
              <ItemGroup className="max-h-80 overflow-y-auto">
                {candidates.map((candidate) => {
                  const checkboxId = `import-${candidate.id}`
                  return (
                    <Item key={candidate.id} size="sm" variant="outline">
                      <ItemMedia>
                        <Checkbox
                          checked={selectedIds.includes(candidate.id)}
                          id={checkboxId}
                          onCheckedChange={(checked) =>
                            setCandidateChecked(candidate.id, checked)
                          }
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle>
                          <label
                            className="cursor-pointer"
                            htmlFor={checkboxId}
                          >
                            {candidate.analysis.name}
                          </label>
                        </ItemTitle>
                        <ItemDescription title={candidate.analysis.description}>
                          {candidate.analysis.description}
                        </ItemDescription>
                        <ItemDescription title={candidate.analysis.entryPath}>
                          {candidate.sourceName} ·{" "}
                          {candidate.analysis.entryPath}
                        </ItemDescription>
                        <ItemDescription>
                          {t("pages.skills.packageSummary", {
                            count: candidate.analysis.fileCount,
                            size: formatBytes(candidate.analysis.unpackedSize),
                          })}
                        </ItemDescription>
                      </ItemContent>
                      <ItemMedia variant="icon">
                        <HugeiconsIcon
                          icon={DocumentValidationIcon}
                          strokeWidth={2}
                        />
                      </ItemMedia>
                    </Item>
                  )
                })}
              </ItemGroup>
              <FieldError>{scanWarnings.join("\n")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="batch-skill-tags">
                {t("pages.skills.tags")}
              </FieldLabel>
              <SkillTagSelect
                id="batch-skill-tags"
                open={tagsOpen}
                options={availableTags}
                placeholder={t("pages.skills.tagsPlaceholder")}
                value={selectedTagIds}
                onOpenChange={setTagsOpen}
                onValueChange={setSelectedTagIds}
              />
            </Field>
            <Field data-invalid={authorizationIsEmpty}>
              <FieldLabel htmlFor="batch-skill-authorized-users">
                {t("pages.skills.authorizedUsers")}
              </FieldLabel>
              <AuthorizationSelect
                id="batch-skill-authorized-users"
                open={authorizationOpen}
                placeholder={t("pages.skills.authorizationPlaceholder")}
                title={t("pages.skills.authorizedUsers")}
                value={authorization}
                onOpenChange={setAuthorizationOpen}
                onValueChange={setAuthorization}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("source")}
            >
              {t("pages.skills.batchImport.previous")}
            </Button>
            <Button
              disabled={selectedCandidates.length === 0 || authorizationIsEmpty}
              type="button"
              onClick={handleImport}
            >
              {t("pages.skills.batchImport.import", {
                count: selectedCandidates.length,
              })}
            </Button>
          </DialogFooter>
        </div>
      )}
    </div>
  )
}
