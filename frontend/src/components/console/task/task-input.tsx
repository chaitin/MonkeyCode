import { Api, ConstsCliName, ConstsGitPlatform, ConstsHostStatus, ConstsInterfaceType, ConstsOwnerType, ConstsTaskSubType, ConstsTaskType, ConstsUserRole, type DomainAuthRepository, type DomainGitIdentity, type DomainModel, type DomainSkill } from "@/api/Api";
import Icon from "@/components/common/Icon";
import { useCommonData } from "@/components/console/data-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getBrandFromModelName, getGitPlatformIcon, getHostBadges, getImageShortName, getInterfaceTypeBadge, getModelHealthBadge, getOSFromImageName, getOwnerTypeBadge, getRepoIcon, getRepoNameFromUrl, getSkillTagIcon, selectHost, selectImage, selectModel } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconBug, IconLink, IconPuzzle, IconSend, IconSourceCode, IconTerminal2, IconUpload, IconUser, IconVocabulary, IconXboxX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsDialog } from "@/pages/console/user/page";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { VoiceInputButton } from "./voice-input-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { defaultSkills } from "@/utils/config";


interface SkillItemProps {
  skill: DomainSkill;
  selectedSkills: string[];
  onSkillChange: (skillName: string, checked: boolean) => void;
}

function SkillItem({ skill, selectedSkills, onSkillChange }: SkillItemProps) {
  if (!skill.id) {
    return null;
  }

  const isChecked = selectedSkills.includes(skill.id);

  return (
    <div 
      className="cursor-pointer hover:bg-accent rounded-md px-2 py-1 items-center flex flex-row gap-2" 
      onClick={() => { onSkillChange(skill.id!, !isChecked)}}>
      <Checkbox checked={isChecked} disabled={defaultSkills.includes(skill.id!)} />
      <div>
        <div className="text-sm cursor-pointer">
          {skill.name}
        </div>
        <div className="text-xs text-muted-foreground break-all line-clamp-1">
          {skill.description}
        </div>
      </div>
    </div>
  );
}

interface RepoOption {
  gitIdentityId: string;
  username: string;
  repository: DomainAuthRepository;
}

/** 支持从仓库列表选择的身份（GitHub App、Gitee、Gitea、GitLab OAuth） */
function isIdentityWithRepos(identity: DomainGitIdentity): boolean {
  if (identity.platform === ConstsGitPlatform.GitPlatformGithub) {
    return identity.is_installation_app === true;
  }
  return [
    ConstsGitPlatform.GitPlatformGitee,
    ConstsGitPlatform.GitPlatformGitea,
    ConstsGitPlatform.GitPlatformGitLab,
  ].includes(identity.platform as ConstsGitPlatform);
}

interface TaskInputProps {
  repos: string[];
  onTaskCreated: () => void;
}

export function TaskInput({ repos, onTaskCreated }: TaskInputProps) {
  const navigate = useNavigate()
  // 输入相关状态
  const [taskContent, setTaskContent] = useState<string>("");
  const [taskType, setTaskType] = useState<ConstsTaskType>(ConstsTaskType.TaskTypeDevelop);
  const [taskTypePopoverOpen, setTaskTypePopoverOpen] = useState<boolean>(false);
  const [skillPopoverOpen, setSkillPopoverOpen] = useState<boolean>(false);
  const [searchInput, setSearchInput] = useState<string>("");
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedRepoDisplayName, setSelectedRepoDisplayName] = useState<string>("");
  const [selectedRepoFromMyRepos, setSelectedRepoFromMyRepos] = useState<boolean>(false);
  const [reposByIdentity, setReposByIdentity] = useState<Record<string, RepoOption[]>>({});
  const [loadingByIdentity, setLoadingByIdentity] = useState<Record<string, boolean>>({});
  const [identitySearch, setIdentitySearch] = useState<Record<string, string>>({});
  const [codeDropdownOpen, setCodeDropdownOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string[]>(defaultSkills);
  const [skillList, setSkillList] = useState<DomainSkill[]>([]);

  // 运行参数状态（工具固定为 opencode）
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [selectedImageId, setSelectedImageId] = useState<string>("");
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("");
  const [branch, setBranch] = useState<string>("");

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [creatingTask, setCreatingTask] = useState<boolean>(false);

  // 上传相关状态
  const [uploadDialogOpen, setUploadDialogOpen] = useState<boolean>(false);
  const [uploadingZip, setUploadingZip] = useState<boolean>(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { models, images, hosts, identities, user } = useCommonData();
  const { setOpen: setSettingsOpen } = useSettingsDialog();

  const modelsWithEconomy = useMemo(() => {
    const economyModel = { 
      id: "economy", 
      model: "免费模型", 
      owner: { type: "public" as const }, 
      is_default: false,
      interface_type: ConstsInterfaceType.InterfaceTypeOpenAIChat,
      last_check_success: true
    } as DomainModel;
    return [economyModel, ...models];
  }, [models]);

  const selectableIdentities = useMemo(
    () => identities.filter(isIdentityWithRepos),
    [identities]
  );


  // 根据选中的仓库自动匹配身份凭证；若用户已显式选择（如从「我的仓库」选中、或选择「匿名」），且该身份仍在匹配列表中，则保留用户选择
  useEffect(() => {
    const matchedIdentities = identities.filter((identity) => {
      return selectedRepo.startsWith(identity.base_url || '');
    });
    const userChoiceStillValid = selectedIdentityId === "none" || matchedIdentities.some((id) => id.id === selectedIdentityId);
    if (!userChoiceStillValid) {
      setSelectedIdentityId(matchedIdentities[0]?.id || "none");
    }
  }, [selectedRepo, identities, selectedIdentityId])

  useEffect(() => {
    fetchSkillList();
  }, []);


  const fetchSkillList = () => {
    apiRequest('v1SkillsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setSkillList(resp.data || []);
      } else {
        toast.error(resp.message || '获取技能列表失败');
      }
    });
  };

  const loadReposForAllIdentities = async () => {
    setLoadingByIdentity((prev) => {
      const next = { ...prev };
      selectableIdentities.forEach((i) => {
        if (i.id) next[i.id] = true;
      });
      return next;
    });
    setReposByIdentity({});

    const newRepos: Record<string, RepoOption[]> = {};
    const newLoading: Record<string, boolean> = {};

    for (const identity of selectableIdentities) {
      const id = identity.id;
      if (!id) continue;
      await new Promise<void>((resolve) => {
        apiRequest(
          "v1UsersGitIdentitiesDetail",
          {},
          [id],
          (detailResp) => {
            if (detailResp.code !== 0) {
              newLoading[id] = false;
              resolve();
              return;
            }
            const authorizedRepositories = detailResp.data?.authorized_repositories || [];
            const repos: RepoOption[] = [];
            for (const repo of authorizedRepositories) {
              if (!repo.url?.trim()) continue;
              repos.push({
                gitIdentityId: id,
                username: identity.username || "未命名身份",
                repository: repo,
              });
            }
            newRepos[id] = repos;
            newLoading[id] = false;
            resolve();
          },
          () => {
            newLoading[id] = false;
            resolve();
          }
        );
      });
    }

    setReposByIdentity((prev) => ({ ...prev, ...newRepos }));
    setLoadingByIdentity((prev) => ({ ...prev, ...newLoading }));
  };

  const setDefaultConfig = () => {
    setSelectedModelId(selectModel(modelsWithEconomy, true))
    setSelectedHostId(selectHost(hosts, true))

    if (user.role === ConstsUserRole.UserRoleSubAccount) {
      setSelectedHostId(selectHost(hosts, true))
      setSelectedImageId(selectImage(images, true));
    } else {
      setSelectedHostId(selectHost(hosts, false))
      setSelectedImageId(selectImage(images, false));
    }
  };

  const adaptedModelForTool = (): boolean => {
    // 固定使用 opencode，支持所有模型
    return true;
  };

  const selectedModel = useMemo(
    () => modelsWithEconomy.find((model) => model.id === selectedModelId),
    [modelsWithEconomy, selectedModelId]
  );

  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic;

  useEffect(() => {
    if (selectedPublicModel && selectedHostId && selectedHostId !== "public_host") {
      setSelectedHostId("public_host");
    }
  }, [selectedPublicModel, selectedHostId]);

  const readyToExecuteTask = () => {
    if (!taskContent.trim()) {
      toast.error('请输入任务内容');
      return;
    }

    // 检查公共模型与非公共宿主机的组合
    if (selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic && selectedHostId !== "public_host") {
      toast.warning('内置模型只能在内置宿主机上使用');
      return;
    }

    executeTask();
  };

  const executeTask = async () => {
    setCreatingTask(true);
    await apiRequest('v1UsersTasksCreate', {
      cli_name: ConstsCliName.CliNameOpencode,
      content: taskContent,
      git_identity_id: (selectedIdentityId && selectedIdentityId !== "none") ? selectedIdentityId : undefined,
      host_id: selectedHostId,
      image_id: selectedImageId,
      model_id: selectedModelId,
      task_type: taskType,
      sub_type: taskType === ConstsTaskType.TaskTypeDesign ? ConstsTaskSubType.TaskSubTypeGenerateRequirement : undefined,
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
        toast.success('任务启动成功');
        onTaskCreated();
        navigate(`/console/task/${resp.data?.id}`);
      } else {
        toast.error(resp.message || "任务启动失败");
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
      toast.error('请选择 ZIP 格式的文件');
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('文件大小不能超过 10MB');
      return;
    }
    
    setSelectedZipFile(file);
    setUploadDialogOpen(true);
  };

  const handleZipUpload = async () => {
    if (!selectedZipFile) {
      toast.error('请选择要上传的文件');
      return;
    }

    setUploadingZip(true);
    try {
      const api = new Api();
      const presignResponse = await api.api.v1UploaderPresignCreate({
        filename: selectedZipFile.name,
        usage: "repo",
        expires: 600,
      });

      if (presignResponse.data?.code !== 0 || !presignResponse.data?.data) {
        toast.error('获取上传地址失败: ' + (presignResponse.data?.message || '未知错误'));
        return;
      }

      const { upload_url, access_url } = presignResponse.data.data;

      if (!upload_url || !access_url) {
        toast.error('获取上传地址失败: 返回数据不完整');
        return;
      }

      const uploadResponse = await fetch(upload_url, {
        method: 'PUT',
        body: selectedZipFile,
        headers: {
          'Content-Type': 'application/zip',
        },
      });

      if (!uploadResponse.ok) {
        toast.error('文件上传失败: ' + uploadResponse.statusText);
        return;
      }

      setSelectedRepo(access_url);
      setSelectedRepoDisplayName(selectedZipFile.name);
      setSelectedRepoFromMyRepos(false);
      setUploadDialogOpen(false);
      setSelectedZipFile(null);
      toast.success('ZIP 文件上传成功');
    } catch (error) {
      toast.error('上传失败: ' + (error as Error).message);
    } finally {
      setUploadingZip(false);
    }
  };

  const handleExecuteButtonClick = () => {
    if (!taskContent.trim()) {
      toast.error('请输入任务内容');
      return;
    }

    flushSync(() => {
      setDefaultConfig();
    });
    setDialogOpen(true);
  };

  const skillTags = useMemo(() => {    // 统计每个 tag 关联的技能数量
    const tagCountMap = new Map<string, number>();
    
    skillList.forEach((skill) => {
      (skill.tags || []).forEach((tag) => {
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1);
      });
    });
    
    // 按照关联技能数量降序排序
    const sortedTags = Array.from(tagCountMap.keys()).sort((a, b) => {
      return tagCountMap.get(b)! - tagCountMap.get(a)!;
    });
    
    return ["全部"].concat(sortedTags);
  }, [skillList]);

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
          placeholder="请输入任务内容" 
          value={taskContent} 
          onChange={(e) => setTaskContent(e.target.value)} 
        />
        <InputGroupAddon align="block-end" className="flex flex-row w-full justify-between">
          <div className="flex flex-row gap-2">
            <Popover open={taskTypePopoverOpen} onOpenChange={setTaskTypePopoverOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-full text-primary hover:text-primary">
                  {taskType === ConstsTaskType.TaskTypeDevelop && <><IconTerminal2 /><span className="hidden sm:block">开发</span></>}
                  {taskType === ConstsTaskType.TaskTypeDesign && <><IconVocabulary /><span className="hidden sm:block">设计</span></>}
                  {taskType === ConstsTaskType.TaskTypeReview && <><IconBug /><span className="hidden sm:block">审查</span></>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="start">
                <Command>
                  <CommandList>
                    <CommandGroup>
                      <CommandItem value={ConstsTaskType.TaskTypeDevelop} onSelect={() => {
                        setTaskType(ConstsTaskType.TaskTypeDevelop);
                        setTaskTypePopoverOpen(false);
                      }} >
                        <div className="flex flex-row gap-2 items-center" >
                          <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                            <IconTerminal2 className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col" >
                            <div className="font-bold">开发</div>
                            <div className="text-muted-foreground text-xs">根据需求执行开发编码任务</div>
                          </div>
                        </div>
                      </CommandItem>
                      <CommandItem value={ConstsTaskType.TaskTypeDesign} onSelect={() => {
                        setTaskType(ConstsTaskType.TaskTypeDesign);
                        setTaskTypePopoverOpen(false);
                      }}>
                        <div className="flex flex-row gap-2 items-center" >
                          <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                            <IconVocabulary className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col" >
                            <div className="font-bold">设计</div>
                            <div className="text-muted-foreground text-xs">进行架构设计，输出技术方案与设计文档</div>
                          </div>
                        </div>
                      </CommandItem>
                      <CommandItem value={ConstsTaskType.TaskTypeReview} onSelect={() => {
                        setTaskType(ConstsTaskType.TaskTypeReview);
                        setTaskTypePopoverOpen(false);
                      }}>
                        <div className="flex flex-row gap-2 items-center" >
                          <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                            <IconBug className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col" >
                            <div className="font-bold">审查</div>
                            <div className="text-muted-foreground text-xs">审查代码，识别风险，提出改进建议</div>
                          </div>
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <DropdownMenu open={codeDropdownOpen}             onOpenChange={(open) => {
              setCodeDropdownOpen(open);
              if (open) {
                loadReposForAllIdentities();
                setIdentitySearch({});
              }
            }}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className={cn("rounded-full max-w-[200px] sm:max-w-full", selectedRepo ? "text-primary hover:text-primary" : "")}>
                  <IconSourceCode />
                  <span className="line-clamp-1 break-all text-ellipsis hidden sm:block">
                    {selectedRepo ? (selectedRepoDisplayName || getRepoNameFromUrl(selectedRepo)) : "代码"}
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
                  清空选择
                </DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <IconUpload className="size-4" />
                  ZIP 文件
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconUser className="size-4" />
                    我的仓库
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="min-w-[200px] p-0">
                      {selectableIdentities.length === 0 ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <span className="text-sm text-muted-foreground">尚未绑定 Git 账号，请先绑定</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCodeDropdownOpen(false);
                              setSettingsOpen(true);
                            }}
                          >
                            去设置
                          </Button>
                        </div>
                      ) : selectableIdentities.map((identity) => {
                        const identityId = identity.id || "";
                        const repos = reposByIdentity[identityId] || [];
                        const isLoading = loadingByIdentity[identityId];
                        const search = identitySearch[identityId] ?? "";
                        const identityLabel = identity.remark || identity.username || identity.base_url || "未命名身份";
                        const filteredRepos = repos.filter((o) => {
                          if (!o.repository.url?.trim()) return false;
                          const kw = search.trim().toLowerCase();
                          if (!kw) return true;
                          const name = (o.repository.full_name || o.repository.url || "").toLowerCase();
                          const desc = (o.repository.description || "").toLowerCase();
                          const user = (o.username || "").toLowerCase();
                          return name.includes(kw) || desc.includes(kw) || user.includes(kw);
                        });
                        return (
                          <DropdownMenuSub key={identityId}>
                            <DropdownMenuSubTrigger className="w-full">
                              {getGitPlatformIcon(identity.platform)}
                              <span className="truncate">{identityLabel}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent className="max-h-[320px] overflow-y-auto min-w-[380px] p-0">
                                {isLoading ? (
                                  <Empty className="border border-dashed m-2">
                                    <EmptyHeader>
                                      <EmptyMedia variant="icon">
                                        <Spinner className="size-5" />
                                      </EmptyMedia>
                                      <EmptyDescription>加载中...</EmptyDescription>
                                    </EmptyHeader>
                                  </Empty>
                                ) : repos.length === 0 ? (
                                  <div className="px-3 py-4">
                                    <span className="text-sm text-muted-foreground">没有仓库</span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col bg-popover p-2">
                                    <Input
                                      placeholder="搜索仓库..."
                                      className="text-sm w-full min-w-0"
                                      value={search}
                                      onChange={(e) => setIdentitySearch((prev) => ({ ...prev, [identityId]: e.target.value }))}
                                      onKeyDown={(e) => e.stopPropagation()}
                                    />
                                    <Separator className="my-2" />
                                    <div className="grid gap-2 overflow-y-auto max-h-[240px]">
                                      {filteredRepos.length === 0 ? (
                                        <div className="py-6 text-center text-sm text-muted-foreground">
                                          {search.trim() ? "未找到匹配的仓库" : null}
                                        </div>
                                      ) : (
                                        filteredRepos.map((option) => {
                                          const repoUrl = option.repository.url?.trim() || "";
                                          if (!repoUrl) return null;
                                          const repoName = (option.repository.full_name || repoUrl).replace(`${option.username}/`, "");
                                          const desc = option.repository.description;
                                          return (
                                            <DropdownMenuItem
                                              key={`${option.gitIdentityId}:${repoUrl}`}
                                              onSelect={() => {
                                                setSelectedRepo(repoUrl);
                                                setSelectedRepoDisplayName(repoName);
                                                setSelectedIdentityId(option.gitIdentityId);
                                                setSelectedRepoFromMyRepos(true);
                                              }}
                                              className="flex flex-col items-start gap-0.5 py-1 cursor-pointer min-w-0 max-w-full"
                                            >
                                              <div className="flex items-center gap-2 w-full min-w-0 max-w-[320px]">
                                                {getRepoIcon(repoUrl)}
                                                <span className="truncate flex-1 text-sm" title={repoName}>{repoName}</span>
                                              </div>
                                              <span className="text-xs text-muted-foreground truncate w-full max-w-[400px] pl-6" title={desc || undefined}>
                                                {desc || "暂无描述"}
                                              </span>
                                            </DropdownMenuItem>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconLink className="size-4" />
                    其他仓库
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="p-2">
                      <Input
                        placeholder="输入代码仓库地址，按回车键确认"
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
                              toast.error("请输入正确的仓库地址");
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
            <Popover open={skillPopoverOpen} onOpenChange={setSkillPopoverOpen} >
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className={cn("rounded-full", selectedSkill.length > 0 ? "text-primary hover:text-primary" : "")}>
                  <IconPuzzle />
                  <span className="hidden sm:block">
                    {selectedSkill.length > 0 ? `${selectedSkill.length} 个技能` : '技能'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="flex p-2 w-fit max-w-[90vw] md:max-w-xl max-h-[30vh] overflow-hidden" align="start">
                <Tabs className="flex flex-row">
                  <TabsList className="flex flex-col h-full justify-start overflow-y-auto bg-background p-0 -mr-2 pr-2 gap-1">
                    {skillTags.map((tag, index) => (
                      <TabsTrigger key={index} value={tag} className="w-full text-xs justify-start hover:bg-sidebar-accent data-[state=active]:bg-accent data-[state=active]:shadow-none">
                        {getSkillTagIcon(tag)}
                        {tag}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {skillTags.map((tag, index) => (
                    <TabsContent key={index} value={tag} className="border rounded-md p-1 overflow-y-auto bg-background">
                      {skillList.filter(skill => {
                        return (skill.tags || []).includes(tag) || tag === "全部";
                      }).map((skill, skillIndex) => (
                        <SkillItem 
                          key={skillIndex} 
                          skill={skill} 
                          selectedSkills={selectedSkill}
                          onSkillChange={handleSkillChange}
                        />
                      ))}
                    </TabsContent>
                  ))}
                </Tabs>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-row gap-2">
            <VoiceInputButton
              disabled={false}
              onTextRecognized={(text) => setTaskContent(text)}
            />
            <Button size="sm" className="rounded-full" disabled={creatingTask} onClick={handleExecuteButtonClick}>
              <span className="hidden sm:block">执行</span>
              {creatingTask ? <Spinner /> : <IconSend />}
            </Button>
          </div>
        </InputGroupAddon>
      </InputGroup>

      {/* 运行参数对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle>任务参数</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel>大模型</FieldLabel>
            <FieldContent>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择大模型" />
                </SelectTrigger>
                <SelectContent>
                  {modelsWithEconomy.map((model) => (
                    <SelectItem 
                      key={model.id} 
                      value={model.id || ""} 
                      disabled={!adaptedModelForTool()}>
                      {model.id === "economy" ? (
                        <img src="/logo-colored.png" className="size-4" alt="" />
                      ) : (
                        <Icon name={getBrandFromModelName(model.model || '')} className="size-4" />
                      )}
                      {getModelHealthBadge(model)}
                      {model.model}
                      {model.is_default && <Badge>默认</Badge>}
                      {model.owner?.type === ConstsOwnerType.OwnerTypePublic ? (
                        <Badge>推荐</Badge>
                      ) : (
                        getOwnerTypeBadge(model.owner)
                      )}
                      {model.id !== "economy" && getInterfaceTypeBadge(model.interface_type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>
          {selectedRepo && !selectedRepoDisplayName.endsWith('.zip') && <>
            <Field>
              <FieldLabel>仓库分支</FieldLabel>
              <FieldContent>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="不填则为主分支" className="text-sm" />
              </FieldContent>
            </Field>
            {/* 从「我的仓库」选择的仓库已绑定身份凭证，不展示该选项 */}
            {!selectedRepoFromMyRepos && (
              <Field>
                <FieldLabel>仓库身份凭证</FieldLabel>
                <FieldContent>
                  <Select value={selectedIdentityId || "none"} onValueChange={setSelectedIdentityId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择身份" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">匿名</SelectItem>
                      {identities.filter((identity) => selectedRepo.startsWith(identity.base_url || '')).length > 0 ? (
                        identities.filter((identity) => selectedRepo.startsWith(identity.base_url || '')).map((identity) => (
                          <SelectItem key={identity.id} value={identity.id as string}>
                            {getGitPlatformIcon(identity.platform || '')}
                            {identity.remark || identity.username}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="unknown" disabled>该仓库未配置身份凭证</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            )}
          </>}
          {user.role === ConstsUserRole.UserRoleSubAccount && <Field>
            <FieldLabel>宿主机</FieldLabel>
            <FieldContent>
              <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择开发工具" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"public_host"}>
                    <div className="flex items-center gap-2">
                      <span>MonkeyCode</span>
                      <Badge>免费</Badge>
                    </div>
                  </SelectItem>
                  {hosts.map((host) => {
                    return (
                      <SelectItem
                        key={host.id}
                        value={host.id!}
                        disabled={host.status !== ConstsHostStatus.HostStatusOnline || selectedPublicModel}>
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
          {user.role === ConstsUserRole.UserRoleSubAccount && <Field>
            <FieldLabel>系统镜像</FieldLabel>
            <FieldContent>
              <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择开发工具" />
                </SelectTrigger>
                <SelectContent>
                  {images.filter(image => image.id).map((image) => (
                    <SelectItem key={image.id} value={image.id!}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2">
                            <Icon name={getOSFromImageName(image.name || '')} className="h-4 w-4" />
                            <span>{image.remark || getImageShortName(image.name || '')}</span>
                            {image.is_default && <Badge>默认</Badge>}
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
          </Field>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={creatingTask} onClick={() => {
              readyToExecuteTask();
            }}>
              {creatingTask && <Spinner />}
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 隐藏的文件选择 input */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".zip"
        onChange={handleZipFileSelect}
      />

      {/* ZIP 文件上传确认对话框 */}
      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        if (!uploadingZip) {
          setUploadDialogOpen(open);
          if (!open) setSelectedZipFile(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传 ZIP 文件</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
            <IconUpload className="size-5 text-muted-foreground" />
            <span className="text-sm truncate">
              {selectedZipFile?.name || '未选择文件'}
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
              取消
            </Button>
            <Button onClick={handleZipUpload} disabled={uploadingZip || !selectedZipFile}>
              {uploadingZip && <Spinner />}
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
