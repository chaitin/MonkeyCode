import { ConstsCliName, ConstsGitPlatform, ConstsHostStatus, ConstsOwnerType, ConstsTaskType, ConstsUserRole, type DomainGitIdentity, type DomainSkillListItem } from "@/api/Api";
import Icon from "@/components/common/Icon";
import { useCommonData } from "@/components/console/data-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { findIdentitiesForRepoUrl, getGitPlatformIcon, getHostBadges, getImageShortName, getOSFromImageName, getOwnerTypeBadge, getRepoIcon, getRepoNameFromUrl, selectHost, selectImage, selectPreferredTaskModel, uploadFileWithPresignedUrl } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconLink, IconSend, IconSourceCode, IconUpload, IconUser, IconXboxX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsDialog } from "@/pages/console/user/settings-dialog-context";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { VoiceInputButton } from "./voice-input-button";
import { TaskConcurrentLimitDialog } from "./task-concurrent-limit-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defaultSkills } from "@/utils/config";
import { IS_OFFLINE_EDITION } from "@/utils/edition";
import { readStoredTaskDialogParams, writeStoredTaskDialogParams } from "./task-dialog-params-storage";
import { IdentityRepoSubmenu } from "./identity-repo-submenu";
import ModelSelect from "./model-select";
import { ALL_SKILLS_TAG, TaskSkillSelector } from "./task-skill-selector";
import { MAX_TASK_CONTENT_LENGTH } from "./task-content-limit";
import { filterSelectableSkillIds } from "./task-skill-selection";
import { useTranslation } from "react-i18next";

type DomainSkill = DomainSkillListItem & { tags?: string[] };

/** Identities that can be used to select repositories from the repository list. */
function isIdentityWithRepos(identity: DomainGitIdentity): boolean {
  return [
    ConstsGitPlatform.GitPlatformGithub,
    ConstsGitPlatform.GitPlatformGitee,
    ConstsGitPlatform.GitPlatformGitea,
    ConstsGitPlatform.GitPlatformGitLab,
    ConstsGitPlatform.GitPlatformCodeup,
    ConstsGitPlatform.GitPlatformCnb,
    ConstsGitPlatform.GitPlatformAtomgit,
  ].includes(identity.platform as ConstsGitPlatform);
}

interface TaskInputProps {
  repos: string[];
  onTaskCreated: () => void;
}

export function TaskInput({ repos, onTaskCreated }: TaskInputProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [taskContent, setTaskContent] = useState<string>("");
  const taskType = ConstsTaskType.TaskTypeDevelop;
  const [skillPopoverOpen, setSkillPopoverOpen] = useState<boolean>(false);
  const [searchInput, setSearchInput] = useState<string>("");
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedRepoDisplayName, setSelectedRepoDisplayName] = useState<string>("");
  const [selectedRepoFromMyRepos, setSelectedRepoFromMyRepos] = useState<boolean>(false);
  const [codeDropdownOpen, setCodeDropdownOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string[]>(defaultSkills);
  const [skillList, setSkillList] = useState<DomainSkill[]>([]);
  const [activeSkillTag, setActiveSkillTag] = useState<string>(ALL_SKILLS_TAG);

  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [selectedImageId, setSelectedImageId] = useState<string>("");
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("");
  const [branch, setBranch] = useState<string>("");

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [creatingTask, setCreatingTask] = useState<boolean>(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  const [uploadDialogOpen, setUploadDialogOpen] = useState<boolean>(false);
  const [uploadingZip, setUploadingZip] = useState<boolean>(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { models, images, hosts, identities, user, subscription } = useCommonData();
  const { setOpen: setSettingsOpen } = useSettingsDialog();

  const selectableIdentities = useMemo(
    () => identities.filter(isIdentityWithRepos),
    [identities]
  );

  useEffect(() => {
    const userChoiceStillValid =
      selectedIdentityId === "none" ||
      identities.some((id) => id.id === selectedIdentityId);
    if (userChoiceStillValid) {
      return;
    }
    const matched = findIdentitiesForRepoUrl(selectedRepo, identities);
    setSelectedIdentityId(matched[0]?.id || "none");
  }, [selectedRepo, identities, selectedIdentityId])

  const fetchSkillList = useCallback(() => {
    apiRequest('v1SkillsList', {}, [], (resp) => {
      if (resp.code === 0) {
        const skills = resp.data || [];
        setSkillList(skills);
        setSelectedSkill((prev) => filterSelectableSkillIds(prev, skills));
      } else {
        toast.error(resp.message || t("taskWorkflow.toast.fetchSkillsFailed"));
      }
    });
  }, [t]);

  useEffect(() => {
    fetchSkillList();
  }, [fetchSkillList]);

  const setDefaultConfig = () => {
    const storedParams = readStoredTaskDialogParams();
    setSelectedModelId(selectPreferredTaskModel(models, subscription));
    const nextImageId = (
      storedParams.imageId
      && images.some((image) => image.id === storedParams.imageId)
    )
      ? storedParams.imageId
      : selectImage(images, true);

    setSelectedImageId(nextImageId);

    if (user.role === ConstsUserRole.UserRoleSubAccount) {
      const nextHostId = hosts.some((host) => host.id === storedParams.hostId && host.status === ConstsHostStatus.HostStatusOnline)
        ? (storedParams.hostId || "public_host")
        : IS_OFFLINE_EDITION
          ? (hosts.find((host) => host.id && host.status === ConstsHostStatus.HostStatusOnline)?.id || "")
          : selectHost(hosts, true);

      setSelectedHostId(nextHostId);
      return;
    }

    setSelectedHostId(selectHost(hosts, false));
  };

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  );

  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic;
  const taskContentLength = taskContent.length;
  const taskContentTooLong = taskContentLength > MAX_TASK_CONTENT_LENGTH;

  const validateTaskContent = () => {
    if (!taskContent.trim()) {
      toast.error(t("taskWorkflow.toast.missingContent"));
      return false;
    }

    if (taskContentTooLong) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }));
      return false;
    }

    return true;
  };

  useEffect(() => {
    if (!IS_OFFLINE_EDITION && selectedPublicModel && selectedHostId && selectedHostId !== "public_host") {
      setSelectedHostId("public_host");
    }
  }, [selectedPublicModel, selectedHostId]);

  const readyToExecuteTask = () => {
    if (!validateTaskContent()) {
      return;
    }

    if (!selectedModelId) {
      toast.error(t("taskWorkflow.toast.missingModel"));
      return;
    }

    if (!IS_OFFLINE_EDITION && selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic && selectedHostId !== "public_host") {
      toast.warning(t("taskWorkflow.toast.builtinModelHostOnly"));
      return;
    }

    const storedParams = readStoredTaskDialogParams();
    writeStoredTaskDialogParams({
      hostId: user.role === ConstsUserRole.UserRoleSubAccount ? selectedHostId : storedParams.hostId,
      imageId: selectedImageId,
    });

    executeTask();
  };

  const executeTask = async () => {
    if (!validateTaskContent()) {
      return;
    }

    setCreatingTask(true);
    await apiRequest('v1UsersTasksCreate', {
      cli_name: ConstsCliName.CliNameOpencode,
      content: taskContent,
      git_identity_id: (selectedIdentityId && selectedIdentityId !== "none") ? selectedIdentityId : undefined,
      host_id: selectedHostId,
      image_id: selectedImageId,
      model_id: selectedModelId,
      task_type: taskType,
      repo: selectedRepoDisplayName.endsWith('.zip') ? {
        zip_url: selectedRepo,
        repo_filename: selectedRepoDisplayName,
      } : {
        repo_url: selectedRepo || undefined,
        branch: branch || undefined,
      },
      extra: {
        skill_ids: selectedSkill,
      },
      resource: {
        core: 2,
        memory: 8 * 1024 * 1024 * 1024,
        life: 3 * 60 * 60,
      },
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("taskWorkflow.toast.taskStarted"));
        onTaskCreated();
        navigate(`/console/task/${resp.data?.id}`);
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true);
      } else {
        toast.error(resp.message || t("taskWorkflow.toast.taskStartFailed"));
      }
    });
    setDialogOpen(false);
    setCreatingTask(false);
  };

  const handleZipFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    e.target.value = "";
    
    if (!file.name.endsWith('.zip')) {
      toast.error(t("taskWorkflow.toast.invalidZipFile"));
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(t("taskWorkflow.toast.zipTooLarge"));
      return;
    }
    
    setSelectedZipFile(file);
    setUploadDialogOpen(true);
  };

  const handleZipUpload = async () => {
    if (!selectedZipFile) {
      toast.error(t("taskWorkflow.toast.missingUploadFile"));
      return;
    }

    setUploadingZip(true);
    try {
      const uploadedFile = await uploadFileWithPresignedUrl(selectedZipFile);

      setSelectedRepo(uploadedFile.accessUrl);
      setSelectedRepoDisplayName(selectedZipFile.name);
      setSelectedRepoFromMyRepos(false);
      setUploadDialogOpen(false);
      setSelectedZipFile(null);
      toast.success(t("taskWorkflow.toast.zipUploaded"));
    } catch (error) {
      toast.error(t("taskWorkflow.toast.uploadFailed", { message: (error as Error).message }));
    } finally {
      setUploadingZip(false);
    }
  };

  const handleExecuteButtonClick = () => {
    if (!validateTaskContent()) {
      return;
    }

    flushSync(() => {
      setDefaultConfig();
    });
    setDialogOpen(true);
  };

  const skillTags = useMemo(() => {
    const tagCountMap = new Map<string, number>();
    
    skillList.forEach((skill) => {
      (skill.tags || []).forEach((tag) => {
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1);
      });
    });
    
    const sortedTags = Array.from(tagCountMap.keys()).sort((a, b) => {
      return tagCountMap.get(b)! - tagCountMap.get(a)!;
    });
    
    return [ALL_SKILLS_TAG].concat(sortedTags);
  }, [skillList]);

  useEffect(() => {
    if (!skillTags.includes(activeSkillTag)) {
      setActiveSkillTag(skillTags[0] || ALL_SKILLS_TAG);
    }
  }, [activeSkillTag, skillTags]);

  const handleSkillChange = (skillId: string, checked: boolean) => {

    if (defaultSkills.includes(skillId)) {
      return null;
    }

    setSelectedSkill(prev => {
      if (checked) {
        return [...prev, skillId];
      } else {
        return prev.filter(id => id !== skillId);
      }
    });
  };

  return (
    <>
      <InputGroup className="rounded-4xl p-2 pb-0">
        <InputGroupTextarea 
          className="min-h-30 max-h-60 break-all" 
          aria-invalid={taskContentTooLong}
          placeholder={t("taskWorkflow.input.placeholder")}
          value={taskContent} 
          onChange={(e) => setTaskContent(e.target.value)} 
        />
        <InputGroupAddon align="block-end" className="flex flex-row w-full justify-between">
          <div className="flex flex-row gap-2">
            <DropdownMenu open={codeDropdownOpen} onOpenChange={setCodeDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className={cn("rounded-full max-w-[200px] sm:max-w-full", selectedRepo ? "text-primary hover:text-primary" : "")}>
                  <IconSourceCode />
                  <span className="line-clamp-1 break-all text-ellipsis hidden sm:block">
                    {selectedRepo ? (selectedRepoDisplayName || getRepoNameFromUrl(selectedRepo)) : t("taskWorkflow.input.code")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {selectedRepo && <DropdownMenuItem onSelect={() => {
                  setSelectedRepo("");
                  setSelectedRepoDisplayName("");
                  setSelectedRepoFromMyRepos(false);
                }}>
                  <IconXboxX className="size-4" />
                  {t("taskWorkflow.input.clearSelection")}
                </DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <IconUpload className="size-4" />
                  {t("taskWorkflow.input.zipFile")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconUser className="size-4" />
                    {t("taskWorkflow.repo.myRepositories")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="min-w-[200px] p-0">
                      {selectableIdentities.length === 0 ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <span className="text-sm text-muted-foreground">{t("taskWorkflow.repo.unboundGitAccount")}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCodeDropdownOpen(false);
                              setSettingsOpen(true);
                            }}
                          >
                            {t("taskWorkflow.repo.goToSettings")}
                          </Button>
                        </div>
                      ) : selectableIdentities.map((identity) => (
                        <IdentityRepoSubmenu
                          key={identity.id || ""}
                          identity={identity}
                          onSelectRepo={({ repoUrl, repoName, gitIdentityId }) => {
                            setSelectedRepo(repoUrl);
                            setSelectedRepoDisplayName(repoName);
                            setSelectedIdentityId(gitIdentityId);
                            setSelectedRepoFromMyRepos(true);
                          }}
                        />
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconLink className="size-4" />
                    {t("taskWorkflow.repo.otherRepositories")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="p-2">
                      <Input
                        placeholder={t("taskWorkflow.repo.otherRepoPlaceholder")}
                        className="text-sm w-full"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            try {
                              new URL(searchInput);
                              setSelectedRepo(searchInput);
                              setSelectedRepoDisplayName("");
                              setSelectedRepoFromMyRepos(false);
                            } catch {
                              toast.error(t("taskWorkflow.toast.invalidRepoUrl"));
                            }
                          }
                        }}
                      />
                      <Separator className="my-2" />
                      {repos.filter((repo) => repo.includes(searchInput)).map((repo) => (
                        <DropdownMenuItem
                          key={repo}
                          onSelect={() => {
                            setSelectedRepo(repo);
                            setSelectedRepoDisplayName("");
                            setSelectedRepoFromMyRepos(false);
                          }}
                        >
                          {getRepoIcon(repo)}
                          {repo}
                        </DropdownMenuItem>
                      ))}
                      {repos.filter((repo) => !repo.includes(searchInput)).map((repo) => (
                        <DropdownMenuItem
                          key={repo}
                          disabled
                          onSelect={() => {
                            setSelectedRepo(repo);
                            setSelectedRepoDisplayName("");
                            setSelectedRepoFromMyRepos(false);
                          }}
                        >
                          {getRepoIcon(repo)}
                          {repo}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <TaskSkillSelector
              open={skillPopoverOpen}
              onOpenChange={setSkillPopoverOpen}
              selectedSkills={selectedSkill}
              skills={skillList}
              skillTags={skillTags}
              activeSkillTag={activeSkillTag}
              onActiveSkillTagChange={setActiveSkillTag}
              onSkillChange={handleSkillChange}
              triggerClassName="rounded-full"
              labelClassName="hidden sm:block"
            />
          </div>
          <div className="flex flex-row gap-2">
            {!IS_OFFLINE_EDITION && (
              <VoiceInputButton
                disabled={false}
                onTextRecognized={(text) => setTaskContent(text)}
              />
            )}
            <Button size="sm" className="rounded-full" disabled={creatingTask || taskContentTooLong} onClick={handleExecuteButtonClick}>
              <span className="hidden sm:block">{t("taskWorkflow.input.execute")}</span>
              {creatingTask ? <Spinner /> : <IconSend />}
            </Button>
          </div>
        </InputGroupAddon>
      </InputGroup>
      {taskContentTooLong && (
        <div className="mt-1 px-1 text-xs text-destructive">
          {t("taskWorkflow.input.contentTooLongInline", {
            overCount: taskContentLength - MAX_TASK_CONTENT_LENGTH,
            maxCount: MAX_TASK_CONTENT_LENGTH,
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("taskWorkflow.dialog.params.title")}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <Field>
              <FieldLabel>{t("taskWorkflow.dialog.params.model")}</FieldLabel>
              <FieldContent>
                <ModelSelect
                  models={models}
                  selectedModel={selectedModel}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  subscription={subscription}
                />
              </FieldContent>
            </Field>
            {selectedRepo && !selectedRepoDisplayName.endsWith('.zip') && <>
              <Field>
                <FieldLabel>{t("taskWorkflow.dialog.params.branch")}</FieldLabel>
                <FieldContent>
                  <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t("taskWorkflow.dialog.params.branchPlaceholder")} className="text-sm" />
                </FieldContent>
              </Field>
              {!selectedRepoFromMyRepos && (
                <Field>
                  <FieldLabel>{t("taskWorkflow.dialog.params.identity")}</FieldLabel>
                  <FieldContent>
                    <Select value={selectedIdentityId || "none"} onValueChange={setSelectedIdentityId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("taskWorkflow.dialog.params.selectIdentity")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("taskWorkflow.dialog.params.anonymous")}</SelectItem>
                        {(() => {
                          const matched = findIdentitiesForRepoUrl(selectedRepo, identities);
                          return matched.length > 0 ? (
                            matched.map((identity) => (
                              <SelectItem key={identity.id} value={identity.id as string}>
                                {getGitPlatformIcon(identity.platform || '')}
                                {identity.remark || identity.username}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="unknown" disabled>{t("taskWorkflow.dialog.params.noIdentity")}</SelectItem>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              )}
            </>}
            {user.role === ConstsUserRole.UserRoleSubAccount && <Field>
              <FieldLabel>{t("taskWorkflow.dialog.params.host")}</FieldLabel>
              <FieldContent>
                <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("taskWorkflow.dialog.params.selectHost")} />
                  </SelectTrigger>
                  <SelectContent>
                    {!IS_OFFLINE_EDITION && (
                      <SelectItem value={"public_host"}>
                        <div className="flex items-center gap-2">
                          <span>MonkeyCode</span>
                          <Badge className="!text-primary-foreground">{t("taskWorkflow.dialog.params.free")}</Badge>
                        </div>
                      </SelectItem>
                    )}
                    {hosts.map((host) => {
                      return (
                        <SelectItem
                          key={host.id}
                          value={host.id!}
                          disabled={host.status !== ConstsHostStatus.HostStatusOnline || (!IS_OFFLINE_EDITION && selectedPublicModel)}>
                          <div className="flex items-center gap-2">
                            <span>{host.remark || `${host.name}-${host.external_ip}`}</span>
                            {getHostBadges(host)}
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>}
            <Field>
              <FieldLabel>{t("taskWorkflow.dialog.params.image")}</FieldLabel>
              <FieldContent>
                <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("taskWorkflow.dialog.params.selectImage")} />
                  </SelectTrigger>
                  <SelectContent>
                    {images.filter(image => image.id).map((image) => (
                      <SelectItem key={image.id} value={image.id!}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Icon name={getOSFromImageName(image.name || '')} className="h-4 w-4" />
                              <span>{image.remark || getImageShortName(image.name || '')}</span>
                              {getOwnerTypeBadge(image.owner)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {image.name}
                          </TooltipContent>
                        </Tooltip>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("taskWorkflow.dialog.params.cancel")}
            </Button>
            <Button disabled={creatingTask || taskContentTooLong} onClick={() => {
              readyToExecuteTask();
            }}>
              {creatingTask && <Spinner />}
              {t("taskWorkflow.dialog.params.confirmExecute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".zip"
        onChange={handleZipFileSelect}
      />

      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        if (!uploadingZip) {
          setUploadDialogOpen(open);
          if (!open) setSelectedZipFile(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("taskWorkflow.input.uploadZipTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
            <IconUpload className="size-5 text-muted-foreground" />
            <span className="text-sm truncate">
              {selectedZipFile?.name || t("taskWorkflow.input.noFileSelected")}
            </span>
            {selectedZipFile && (
              <Badge variant="outline" className="ml-auto">
                {(selectedZipFile.size / 1024 / 1024).toFixed(2)} MB
              </Badge>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setUploadDialogOpen(false);
              setSelectedZipFile(null);
            }} disabled={uploadingZip}>
              {t("taskWorkflow.dialog.params.cancel")}
            </Button>
            <Button onClick={handleZipUpload} disabled={uploadingZip || !selectedZipFile}>
              {uploadingZip && <Spinner />}
              {t("taskWorkflow.input.upload")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TaskConcurrentLimitDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
      />
    </>
  );
}
