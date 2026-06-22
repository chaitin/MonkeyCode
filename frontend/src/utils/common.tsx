import { Badge } from "@/components/ui/badge"
import { Folder } from "lucide-react"
import Icon from "@/components/common/Icon"
import { IconAssembly, IconBrandChrome, IconBrandPython, IconBug, IconDeviceGamepad2, IconFileText, IconHelpHexagon, IconPalette, IconPuzzle, IconShieldChevron, IconTerminal2, IconTestPipe } from "@tabler/icons-react"
import Cap from "@cap.js/widget"
import { HoverCardContent } from "@/components/ui/hover-card"
import { ConstsGitPlatform, ConstsHostStatus, ConstsInterfaceType, ConstsOwnerType, ConstsProjectIssueStatus, GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, TaskflowVirtualMachineStatus, type DomainGitIdentity, type DomainHost, type DomainImage, type DomainModel, type DomainOwner, type DomainProjectTask, type DomainProviderModelListItem, type DomainSubscriptionResp, type DomainUser, type DomainVirtualMachine, type GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition } from "@/api/Api"
import { apiRequest } from "./requestUtils"
import { remark } from "remark"
import strip from "strip-markdown"
import i18n from "@/i18n"

function commonText(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options))
}

/** GitHub App install URL: production uses monkeycode-ai.com, other domains use the dev app. */
export function getGithubAppInstallUrl(): string {
  if (typeof window !== "undefined" && window.location.origin === "https://monkeycode-ai.com") {
    return "https://github.com/apps/monkeycode-ai/installations/new"
  }
  return "https://github.com/apps/mcai-dev-nb/installations/new"
}

export function getHostStatusBadge(status?: string) {
  if (status === "online") {
    return null
  } else if (status === "offline") {
    return <Badge variant="destructive">{commonText("commonUtils.status.offline")}</Badge>
  }
  return <Badge variant="outline">{commonText("commonUtils.status.unknown")}</Badge>
}

export function getImageShortName(imageTag: string): string {
  if (!imageTag) {
    return '';
  }
  
  const lastSlashIndex = imageTag.lastIndexOf('/');
  
  if (lastSlashIndex === -1) {
    return imageTag;
  }

  return imageTag.substring(lastSlashIndex + 1);
}

export function getOSFromImageName(imageTag: string): string {
  if (!imageTag) {
    return 'linux';
  }

  const lowerTag = imageTag.toLowerCase();

  // Check supported operating systems in priority order.
  if (lowerTag.includes('centos')) {
    return 'centos';
  }
  if (lowerTag.includes('gentoo')) {
    return 'gentoo';
  }
  if (lowerTag.includes('fedora')) {
    return 'fedora';
  }
  if (lowerTag.includes('arch')) {
    return 'arch';
  }
  if (lowerTag.includes('ubuntu')) {
    return 'ubuntu';
  }
  if (lowerTag.includes('debian')) {
    return 'debian';
  }

  // Fall back to linux when no supported OS is detected.
  return 'linux';
}

export function getBrandFromModelName(modelName: string): string {
  if (!modelName) {
    return 'linux';
  }

  const lowerName = modelName.toLowerCase();

  if (lowerName.includes('gpt')) {
    return 'openai';
  }

  if (lowerName.includes('deepseek')) {
    return 'deepseek';
  }

  if (lowerName.includes('kimi')) {
    return 'kimi';
  }

  if (lowerName.includes('glm')) {
    return 'zhipu';
  }

  if (lowerName.includes('gemini')) {
    return 'gemini';
  }

  if (lowerName.includes('qwen')) {
    return 'qwen';
  }

  if (lowerName.includes('claude')) {
    return 'claude';
  }

  if (lowerName.includes('doubao')) {
    return 'doubao';
  }

  if (lowerName.includes('minimax')) {
    return 'minimax';
  }

  if (lowerName.includes('mimo')) {
    return 'mimo';
  }

  return 'openai';
}

export function getBrandFromModel(model?: Pick<DomainModel, 'model' | 'owner'> | null): string {
  const modelName = model?.model || '';
  if (
    model?.owner?.type === ConstsOwnerType.OwnerTypePublic
    && modelName.toLowerCase().includes('gpt')
  ) {
    return 'model';
  }

  return getBrandFromModelName(modelName);
}

export function getModelDisplayName(modelName?: string | null): string {
  if (!modelName) {
    return modelName || '';
  }

  const builtinModelName = getBuiltinModelName(modelName);
  if (builtinModelName === 'monkeycode-basic') {
    return String(i18n.t("commonUtils.model.basic"));
  }

  if (builtinModelName === 'monkeycode-pro') {
    return commonText("commonUtils.model.pro");
  }

  if (builtinModelName === 'monkeycode-ultra') {
    return commonText("commonUtils.model.ultra");
  }

  return modelName;
}

export function stripBuiltinPublicModelPackagePrefix(modelName?: string | null): string {
  return modelName?.trim().replace(/^monkeycode-[^/]+\//, '') || '';
}

export function getModelDisplayNameForModel(model?: Pick<DomainModel, 'model' | 'remark'> | null): string {
  const remark = model?.remark?.trim();
  if (remark) {
    return stripBuiltinPublicModelPackagePrefix(remark);
  }

  return getModelDisplayName(model?.model);
}

export function getBuiltinModelName(modelName?: string | null): "monkeycode-basic" | "monkeycode-pro" | "monkeycode-ultra" | undefined {
  const normalizedModelName = modelName?.trim().toLowerCase();
  if (!normalizedModelName) {
    return undefined;
  }

  if (normalizedModelName.startsWith('monkeycode-basic')) {
    return 'monkeycode-basic';
  }

  if (normalizedModelName.startsWith('monkeycode-pro')) {
    return 'monkeycode-pro';
  }

  if (normalizedModelName.startsWith('monkeycode-ultra')) {
    return 'monkeycode-ultra';
  }

  return undefined;
}

export function isBuiltinPublicModelPackage(modelName?: string | null): boolean {
  return stripBuiltinPublicModelPackagePrefix(modelName) !== (modelName?.trim() || '');
}

export type ModelPricingItem = {
  model: string;
  credits: number;
  score: number;
  tags: string[];
}

export const modelPricingList: readonly ModelPricingItem[] = [
  { model: "minimax-m3", credits: 250, score: 637, tags: [] },
  { model: "minimax-m2.7", credits: 250, score: 637, tags: [] },
  { model: "minimax-m2.5", credits: 150, score: 513, tags: [] },
  { model: "deepseek-v4-pro", credits: 600, score: 852, tags: [] },
  { model: "qwen3.5-plus", credits: 150, score: 538, tags: ["Long context"] },
  { model: "gpt-5.5", credits: 1000, score: 967, tags: ["Latest", "Very strong"] },
  { model: "gpt-5.4", credits: 600, score: 922, tags: ["Strong"] },
  { model: "gpt-5.3-codex", credits: 500, score: 918, tags: ["Strong"] },
  { model: "glm-5.1", credits: 800, score: 904, tags: [] },
  { model: "glm-5", credits: 600, score: 847, tags: [] },
  { model: "glm-4.7", credits: 400, score: 709, tags: [] },
  { model: "kimi-k2.6", credits: 700, score: 912, tags: [] },
  { model: "kimi-k2.5", credits: 150, score: 579, tags: [] },
  { model: "qwen3.6-max", credits: 600, score: 892, tags: ["Long context"] },
  { model: "qwen3.6-plus", credits: 300, score: 751, tags: ["Long context"] },
]

export const TASK_PROMPT_PLACEHOLDER = "Ask MonkeyCode what to do. For example: build a mini game, implement a feature, analyze data, research a topic, or draft a paper."

export function getTaskPromptPlaceholder(): string {
  return commonText("commonUtils.taskPromptPlaceholder")
}

export function getModelPricingItem(modelName?: string): ModelPricingItem | undefined {
  if (!modelName) {
    return undefined
  }

  const normalizedModelName = modelName.trim().toLowerCase()
  const builtinModelName = getBuiltinModelName(normalizedModelName)
  return modelPricingList.find((item) => item.model.toLowerCase() === (builtinModelName || normalizedModelName))
}

export function formatMemory(bytes?: number): string {
  if (!bytes) return commonText("commonUtils.status.unknown")
  const gb = bytes / (1024 * 1024 * 1024)
  return `${Math.ceil(gb)} GB`
}

export function formatTokens(tokens?: number): string {
  if (tokens === undefined || tokens === null) return ""
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}m`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return tokens.toString()
}


export function humanTime(seconds: number): string {
  seconds = seconds > 0 ? seconds : 0;
  
  if (seconds < 60) { 
    return commonText("commonUtils.time.seconds", { count: Math.floor(seconds) });
  } else if (seconds < 60 * 60) { 
    return commonText("commonUtils.time.minutes", { count: Math.floor(seconds / 60) });
  } else if (seconds < 60 * 60 * 24) { 
    return commonText("commonUtils.time.hours", { count: Math.floor(seconds / 60 / 60) });
  } else { 
    return commonText("commonUtils.time.days", { count: Math.floor(seconds / 60 / 60 / 24) });
  } 
};

export function translateStatus(status?: TaskflowVirtualMachineStatus): string {
  switch (status) {
    case TaskflowVirtualMachineStatus.VirtualMachineStatusOnline:
      return commonText("commonUtils.vmStatus.online")
    case TaskflowVirtualMachineStatus.VirtualMachineStatusPending:
      return commonText("commonUtils.vmStatus.pending")
    case TaskflowVirtualMachineStatus.VirtualMachineStatusOffline:
      return commonText("commonUtils.vmStatus.offline")
    default:
      return status || commonText("commonUtils.status.unknown")
  }
}

export function getStatusBadgeProps(status?: TaskflowVirtualMachineStatus) {
  switch (status) {
    case TaskflowVirtualMachineStatus.VirtualMachineStatusOnline:
      return { variant: 'default' as const, className: 'cursor-default' }
    case TaskflowVirtualMachineStatus.VirtualMachineStatusPending:
      return { variant: 'default' as const, className: 'cursor-default' }
    case TaskflowVirtualMachineStatus.VirtualMachineStatusOffline:
      return { variant: 'outline' as const, className: 'cursor-default' }
    default:
      return { variant: 'outline' as const, className: 'cursor-default' }
  }
}

export function b64encode(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export function b64decode(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

export function normalizePath(path: string): string {
  if (!path) {
    return '/'
  }
  if (!path.startsWith('/')) {
    path = '/' + path
  }
  
  const parts = path.split('/')
  
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop()
      }
    } else if (part !== '.' && part !== '') {
      stack.push(part)
    }
  }
  
  return '/' + stack.join('/')
}


export function getRepoIcon(url: string) {
  if (!url) {
    return <Folder className="size-4" />
  }

  const platform = new URL(url).hostname.toLowerCase()

  switch (platform) {
    case 'github.com':
      return <Icon name="GitHub-Uncolor" className="size-4" />
    case 'gitlab.com':
      return <Icon name="GitLab" className="size-4" />
    case 'gitee.com':
      return <Icon name="Gitee" className="size-4" />
    case 'gitea.com':
      return <Icon name="Gitea" className="size-4" />
    case 'atomgit.com':
      return <Icon name="GitCode" className="size-4" />
    default:
      return <Icon name="GitHub-Uncolor" className="size-4" />
  }
}

/** Infer the git platform from a repository hostname as a fallback for identity matching.
 *  codeup/cnb/atomgit identities store API domains as base_url, which do not match repository hostnames,
 *  so startsWith(base_url) alone cannot match them. */
export function detectGitPlatformFromUrl(url: string): ConstsGitPlatform | undefined {
  if (!url) {
    return undefined
  }
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
  if (hostname === "github.com") {
    return ConstsGitPlatform.GitPlatformGithub
  }
  if (hostname === "gitee.com") {
    return ConstsGitPlatform.GitPlatformGitee
  }
  if (hostname === "gitlab.com") {
    return ConstsGitPlatform.GitPlatformGitLab
  }
  if (hostname === "codeup.aliyun.com" || hostname.endsWith(".codeup.aliyun.com")) {
    return ConstsGitPlatform.GitPlatformCodeup
  }
  if (hostname === "cnb.cool" || hostname.endsWith(".cnb.cool")) {
    return ConstsGitPlatform.GitPlatformCnb
  }
  if (hostname === "atomgit.com" || hostname.endsWith(".atomgit.com")) {
    return ConstsGitPlatform.GitPlatformAtomGit
  }
  return undefined
}

/** Find the most suitable git identities for a repository URL.
 *  1. Prefer base_url prefix matching, which keeps the existing github/gitlab/gitea/gitee behavior.
 *  2. If none match, infer platform from hostname and fall back to identity.platform for codeup/cnb/atomgit. */
export function findIdentitiesForRepoUrl(
  repoUrl: string,
  identities: DomainGitIdentity[],
): DomainGitIdentity[] {
  if (!repoUrl) {
    return []
  }
  const byBaseUrl = identities.filter(
    (identity) => identity.base_url && repoUrl.startsWith(identity.base_url),
  )
  if (byBaseUrl.length > 0) {
    return byBaseUrl
  }
  const platform = detectGitPlatformFromUrl(repoUrl)
  if (!platform) {
    return []
  }
  return identities.filter((identity) => identity.platform === platform)
}

export function getGitPlatformIcon(platform?: string) {
  if (!platform) {
    return <IconHelpHexagon className="size-4" />
  }

  switch (platform.toLowerCase()) {
    case 'github':
      return <Icon name="GitHub-Uncolor" className="fill-foreground size-4" />
    case 'gitlab':
      return <Icon name="GitLab" className="size-4" />
    case 'gitee':
      return <Icon name="Gitee" className="size-4" />
    case 'gitea':
      return <Icon name="Gitea" className="size-4" />
    case 'codeup':
      return <Icon name="Codeup" className="size-4" />
    case 'cnb':
      return <Icon name="Cnb" className="size-4" />
    case 'atomgit':
      return <Icon name="GitCode" className="size-4" />
    default:
      return <IconHelpHexagon className="size-4" />
  }
}

export function getTaskStatusText(status?: string): string {
  switch (status) {
    case 'started':
      return String(i18n.t("commonUtils.taskStatus.started"))
    case 'pending':
      return commonText("commonUtils.taskStatus.pending")
    case 'stopped':
      return commonText("commonUtils.taskStatus.stopped")
    case 'ended':
      return commonText("commonUtils.taskStatus.ended")
    case 'error':
      return commonText("commonUtils.taskStatus.error")
    case 'finished':
      return commonText("commonUtils.taskStatus.finished")
    default:
      return commonText("commonUtils.taskStatus.unknown")
  }
}

export function getRepoNameFromUrl(url?: string): string {
  try {
    const pathname = new URL(url || '').pathname
    return pathname.split('/').pop() || ''
  } catch {
    return ''
  }
}


// Validate email format.
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9+\-\_\.]+@[0-9a-zA-Z\.-]+$/
  return emailRegex.test(email)
}


export async function captchaChallenge(): Promise<string | null> {
  try {
    const cap = new Cap({
      apiEndpoint: '/api/v1/public/captcha/'
    })
    const data = await cap.solve()
    if (data.success) {
      return data.token
    }
    console.error('[captcha] solve() returned success=false', data)
    return null
  } catch (err) {
    console.error('[captcha] exception:', err)
    return null
  }
}

export function renderHoverCardContent(items: ({content: string, title: string} | null)[]): React.ReactNode {
  return <HoverCardContent className="text-xs bg-background break-all flex flex-col gap-2 w-fit max-w-md max-h-[50vh] overflow-y-auto">
    {items.filter((item) => item !== null).map((item) => (
      <div key={item.title} className="flex flex-col gap-1">
        <p className="font-bold">{item.title}</p>
        <p>{item.content}</p>
      </div>
    ))}
  </HoverCardContent>
}


export function getStatusName(status: ConstsProjectIssueStatus): string {
  switch (status) {
    case ConstsProjectIssueStatus.ProjectIssueStatusOpen:
      return commonText("commonUtils.issueStatus.open")
    case ConstsProjectIssueStatus.ProjectIssueStatusCompleted:
      return commonText("commonUtils.issueStatus.completed")
    case ConstsProjectIssueStatus.ProjectIssueStatusClosed:
      return commonText("commonUtils.issueStatus.closed")
    default:
      return commonText("commonUtils.status.unknown")
  }
}

export function getInterfaceTypeBadge(interfaceType?: ConstsInterfaceType): React.ReactNode {
  if (!interfaceType) {
    return null
  }

  switch (interfaceType) {
    case ConstsInterfaceType.InterfaceTypeOpenAIResponse:
      return <Badge variant="secondary">OpenAI Responses</Badge>
    case ConstsInterfaceType.InterfaceTypeOpenAIChat:
      return <Badge variant="secondary">OpenAI Chat</Badge>
    case ConstsInterfaceType.InterfaceTypeAnthropic:
      return <Badge variant="secondary">Anthropic</Badge>
    default:
      return null
  }
}

export function getOwnerTypeBadge(owner?: DomainOwner): React.ReactNode {
  if (!owner) {
    return null
  }

  switch (owner?.type) {
    case ConstsOwnerType.OwnerTypePrivate:
      return <Badge variant="secondary">{commonText("commonUtils.owner.private")}</Badge>
    case ConstsOwnerType.OwnerTypeTeam:
      return <Badge variant="secondary">{owner?.name}</Badge>
    case ConstsOwnerType.OwnerTypePublic:
      return <Badge variant="secondary">{commonText("commonUtils.owner.public")}</Badge>
    default:
      return null
  }
}

export function canUseModelBySubscription(model?: DomainModel, subscription?: DomainSubscriptionResp | null): boolean {
  if (!model) {
    return false
  }

  const builtinModelName = getBuiltinModelName(model.model)
  if (builtinModelName === "monkeycode-pro") {
    return subscription?.plan === "pro" || subscription?.plan === "flagship" || subscription?.plan === "ultra"
  }

  if (builtinModelName === "monkeycode-ultra") {
    return subscription?.plan === "flagship" || subscription?.plan === "ultra"
  }

  return true
}

export function hasProSubscription(subscription?: DomainSubscriptionResp | null): boolean {
  return subscription?.plan === "pro" || subscription?.plan === "flagship" || subscription?.plan === "ultra"
}

export function getSubscriptionPlanLabel(plan?: string | null): string {
  switch (plan) {
    case "flagship":
    case "ultra":
      return commonText("commonUtils.subscription.flagship")
    case "pro":
      return commonText("commonUtils.subscription.pro")
    case "basic":
      return commonText("commonUtils.subscription.basic")
    default:
      return commonText("commonUtils.subscription.basic")
  }
}

export function getSubscriptionPlanShortLabel(plan?: string | null): string {
  switch (plan) {
    case "flagship":
    case "ultra":
      return commonText("commonUtils.subscription.flagshipShort")
    case "pro":
      return commonText("commonUtils.subscription.proShort")
    case "basic":
      return commonText("commonUtils.subscription.basicShort")
    default:
      return commonText("commonUtils.subscription.basicShort")
  }
}

export function canManageDevEnvironment(user?: DomainUser | null): boolean {
  return Boolean(user?.team?.id)
}

export function getHostBadges(host?: DomainHost): React.ReactNode {
  if (!host) {
    return null
  }

  return <>
    {getHostStatusBadge(host.status)}
    {getOwnerTypeBadge(host.owner)}
    {host.arch !== 'x86_64' && <Badge variant="secondary" className="hidden sm:inline">{host.arch}</Badge>}
    <Badge variant="secondary" className="hidden sm:inline">
      {commonText("commonUtils.host.cores", { count: host.cores })}
    </Badge>
    <Badge variant="secondary" className="hidden sm:inline">{formatMemory(host.memory)}</Badge>
  </>
}

export function getLastCondition(vm: DomainVirtualMachine | undefined): GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition | undefined {
  if (!vm) {
    return undefined
  }

  return vm.conditions?.[vm.conditions.length - 1]
}
  

export function getVmMessage(vm: DomainVirtualMachine | undefined): string {
  if (!vm) {
    return ''
  }

  const lastCondition = vm.conditions?.[vm.conditions.length - 1]
  return lastCondition?.message || ''
}

export function getConditionTypeText(conditions: GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition[] | undefined): string {
  if (!conditions) {
    return commonText("commonUtils.conditionStatus.unknown")
  }

  const lastCondition = conditions?.[conditions.length - 1]
  switch (lastCondition?.type) {
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeScheduled:
      return commonText("commonUtils.conditionStatus.scheduled")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeImagePulled:
      return commonText("commonUtils.conditionStatus.imagePulled")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeProjectCloned:
      return commonText("commonUtils.conditionStatus.projectCloned")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeImageBuilt:
      return commonText("commonUtils.conditionStatus.imageBuilt")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeContainerCreated:
      return commonText("commonUtils.conditionStatus.containerCreated")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeContainerStarted:
      return commonText("commonUtils.conditionStatus.containerStarted")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeReady:
      return commonText("commonUtils.conditionStatus.ready")
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed:
      return commonText("commonUtils.conditionStatus.failed")
    default:
      return commonText("commonUtils.conditionStatus.unknown")
  }
}

export function getFileName(path: string): string {
  return path.split('/').pop() || ''
}

/**
 * Package files into a zip file.
 * @param files Files to package.
 * @param zipFilename Output zip filename. Defaults to 'project-files.zip'.
 * @returns The packaged zip File object.
 */
export async function packFilesAsZip(
  files: File[],
  zipFilename: string = 'project-files.zip'
): Promise<File> {
  if (files.length === 0) {
    throw new Error(commonText("commonUtils.file.emptyList"))
  }

  // Return a single zip file directly; there is no need to repackage it.
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return files[0]
  }

  // Dynamically import JSZip and package the files.
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  for (const file of files) {
    zip.file(file.name, file)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  return new File([zipBlob], zipFilename, { type: 'application/zip' })
}

/**
 * Upload a file with the presigned URL returned by the backend.
 * @param file File to upload.
 * @returns Uploaded access URL and filename, or throws on failure.
 */
export async function uploadFileWithPresignedUrl(
  file: File
): Promise<{ accessUrl: string; filename: string }> {
  const presignResult = await new Promise<{ upload_url: string; access_url: string }>((resolve, reject) => {
    apiRequest('v1UploaderPresignCreate', {
      filename: file.name,
    }, [], (resp) => {
      if (resp.code === 0 && resp.data?.upload_url && resp.data?.access_url) {
        resolve({ upload_url: resp.data.upload_url, access_url: resp.data.access_url })
      } else {
        reject(new Error(commonText("commonUtils.upload.presignFailed", { message: resp.message || commonText("commonUtils.status.unknown") })))
      }
    }, (error) => {
      reject(error)
    })
  })

  const uploadResponse = await fetch(presignResult.upload_url, {
    method: 'PUT',
    body: new Blob([file]),
  })

  if (!uploadResponse.ok) {
    throw new Error(commonText("commonUtils.upload.failed", { message: uploadResponse.statusText }))
  }

  return {
    accessUrl: presignResult.access_url,
    filename: file.name,
  }
}

/**
 * Package files into a zip and upload it.
 * @param files Files to package.
 * @param zipFilename Output zip filename. Defaults to 'project-files.zip'.
 * @returns Uploaded access URL and filename, or throws on failure.
 */
export async function packAndUploadFilesAsZip(
  files: File[],
  zipFilename: string = 'project-files.zip'
): Promise<{ accessUrl: string; filename: string }> {
  const zipFile = await packFilesAsZip(files, zipFilename)
  return uploadFileWithPresignedUrl(zipFile)
}

/**
 * Convert markdown text to plain text by stripping formatting markers.
 * @param markdown Original markdown content.
 * @returns Plain text content.
 */
export function stripMarkdown(markdown: string | undefined): string {
  if (!markdown) {
    return ''
  }

  const result = remark().use(strip).processSync(markdown)
  return String(result).trim()
}

export function getTaskDisplayName(task?: Pick<DomainProjectTask, "title" | "summary" | "content"> | null, fallback = ""): string {
  if (!task) {
    return fallback
  }

  const title = task.title?.trim()
  if (title) {
    return title
  }

  const summary = task.summary?.trim()
  if (summary) {
    return summary
  }

  const content = stripMarkdown(task.content)
  if (content) {
    return content
  }

  return fallback
}

/**
 * Get the lowercase extension from a filename.
 * @param filename Filename.
 * @returns Lowercase extension without the dot, or an empty string when absent.
 */
export function getFileExtension(filename: string): string {
  if (!filename) {
    return ''
  }

  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
    return ''
  }

  return filename.slice(lastDotIndex + 1).toLowerCase()
}

export function selectPreferredTaskModel(models: DomainModel[], subscription?: DomainSubscriptionResp | null): string {
  const planPreferredModel = subscription?.plan === "pro"
    ? "monkeycode-pro"
    : subscription?.plan === "flagship" || subscription?.plan === "ultra"
      ? "monkeycode-ultra"
      : "monkeycode-basic"
  const planModel = models
    .filter((model) => (
      model.id
      && getBuiltinModelName(model.model) === planPreferredModel
      && canUseModelBySubscription(model, subscription)
    ))
    .sort((left, right) => {
      const weightDiff = (right.weight || 0) - (left.weight || 0)
      if (weightDiff !== 0) {
        return weightDiff
      }

      return (left.model || "").localeCompare(right.model || "")
    })[0]

  if (planModel?.id) {
    return planModel.id
  }

  const preferredModel = models
    .filter((model) => (
      model.id
      && model.owner?.type === ConstsOwnerType.OwnerTypePublic
      && canUseModelBySubscription(model, subscription)
    ))
    .sort((left, right) => {
      const weightDiff = (right.weight || 0) - (left.weight || 0)
      if (weightDiff !== 0) {
        return weightDiff
      }

      return (left.model || "").localeCompare(right.model || "")
    })[0]

  if (preferredModel?.id) {
    return preferredModel.id
  }

  const fallbackModel = models.find((model) => (
    model.id
    && canUseModelBySubscription(model, subscription)
  ))

  if (!fallbackModel?.id) {
    return ""
  }

  return fallbackModel.id
}


export function selectHost(hosts: DomainHost[], followDefault: boolean = true): string {
  const onlineHosts = hosts.filter(host => host.status === ConstsHostStatus.HostStatusOnline);
  let result = 'public_host'

  if (followDefault) {
    result = onlineHosts[0]?.id || result
  }

  return result
}

export function selectImage(images: DomainImage[], followDefault: boolean = true): string {
  let result = ''

  result = images.find(image => {
    return image.owner?.type === ConstsOwnerType.OwnerTypePublic && image.remark === 'devbox'
  })?.id || result

  if (followDefault) {
    result = images[0]?.id || result
  }

  return result
}

/**
 * Download a file. When writableStream is provided, fetch streams into it; otherwise native browser download is used.
 * @param envid Environment ID.
 * @param path File path.
 * @param filename Download filename. Defaults to the basename from path.
 * @throws Network or download errors in streaming mode.
 */
export interface DownloadFileProgress {
  loaded: number
  total: number | null
  percent: number | null
}

export function getDownloadFileUrl(envid: string, path: string, filename?: string): string {
  const params = new URLSearchParams({
    id: envid,
    path,
  })

  if (filename) {
    params.set('filename', filename)
  }

  return `/api/v1/users/files/download?${params.toString()}`
}

export function nativeDownloadFile(envid: string, path: string, filename?: string): void {
  const downloadFilename = filename || getFileName(path)
  const link = document.createElement('a')

  link.href = getDownloadFileUrl(envid, path, downloadFilename)
  link.download = downloadFilename
  link.style.display = 'none'

  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
  }, 0)
}

export async function downloadFile(
  envid: string,
  path: string,
  filename?: string,
  onProgress?: (progress: DownloadFileProgress) => void,
  signal?: AbortSignal,
  writableStream?: WritableStream<Uint8Array>,
): Promise<void> {
  const downloadFilename = filename || getFileName(path)

  if (!writableStream) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    nativeDownloadFile(envid, path, downloadFilename)
    return
  }

  const url = getDownloadFileUrl(envid, path, downloadFilename)
  
  const response = await fetch(url, { signal })
  
  // x-internal-error indicates a backend-side download failure.
  const internalError = response.headers.get('x-internal-error')
  if (internalError) {
    throw new Error(b64decode(internalError))
  }
  
  if (!response.body) {
    throw new Error(String(i18n.t("commonUtils.download.streamUnavailable")))
  }

  if (!response.ok) {
    throw new Error(commonText("commonUtils.download.failedWithStatus", { status: response.status }))
  }
  
  const contentLength = response.headers.get('content-length')
  const total = contentLength ? Number(contentLength) : null
  
  // Use the caller-provided browser/system write stream to avoid buffering large files in memory.
  const fileStream = writableStream
  const reader = response.body.getReader()
  const writer = fileStream.getWriter()
  let loaded = 0

  onProgress?.({
    loaded,
    total,
    percent: total && total > 0 ? 0 : null,
  })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value) {
        continue
      }

      await writer.write(value)
      loaded += value.byteLength

      onProgress?.({
        loaded,
        total,
        percent: total && total > 0 ? Math.min((loaded / total) * 100, 100) : null,
      })
    }

    await writer.close()
  } catch (error) {
    await writer.abort(error)
    throw error
  } finally {
    reader.releaseLock()
  }
}


export function getModelUrlDescription(baseUrl: string, interfaceType: ConstsInterfaceType): string {
  let url = baseUrl.trim()

  if (!url) {
    return commonText("commonUtils.modelUrl.notSet")
  }

  if (!url.endsWith('/')) {
    url += '/'
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return commonText("commonUtils.modelUrl.invalid")
  }

  switch (interfaceType) {
    case ConstsInterfaceType.InterfaceTypeOpenAIResponse:
      return url + "responses"
    case ConstsInterfaceType.InterfaceTypeOpenAIChat:
      return url + "chat/completions"
    case ConstsInterfaceType.InterfaceTypeAnthropic:
      return url + "v1/messages"
    default:
      return commonText("commonUtils.modelUrl.invalid")
  }
}

/**
 * Deep merge objects.
 * Recursively merges nested objects.
 * @param target Target object.
 * @param source Source object whose properties are merged into the target.
 * @returns New merged object.
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key]
      const targetValue = result[key]
      
      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // Recursively merge plain objects.
        result[key] = deepMerge(targetValue, sourceValue) as T[Extract<keyof T, string>]
      } else {
        // Otherwise overwrite directly.
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }
  
  return result
}



export const modelProviderList: Record<string, DomainProviderModelListItem[]> = {
  "https://api.minimax.io/v1": [
    {"model": "MiniMax-M3"},
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimax.io/anthropic": [
    {"model": "MiniMax-M3"},
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimaxi.com/v1": [
    {"model": "MiniMax-M3"},
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimaxi.com/anthropic": [
    {"model": "MiniMax-M3"},
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2"}
  ]
}

export function getSkillTagIcon(tag: string): React.ReactNode {
  tag = tag.toLowerCase();

  if (tag.includes("ui") || tag.includes("ux") || tag.includes("\u89c6\u89c9")) {
    return <IconPalette className="size-3" />
  }

  if (tag.includes("python")) {
    return <IconBrandPython className="size-3" />
  }
  
  if (tag.includes("\u524d\u7aef")) {
    return <IconBrandChrome className="size-3" />
  }
  
  if (tag.includes("\u6e38\u620f")) {
    return <IconDeviceGamepad2 className="size-3" />
  }

  if (tag.includes("\u5ba1\u8ba1") || tag.includes("\u5b89\u5168")) {
    return <IconShieldChevron className="size-3" />
  }

  if (tag.includes("\u5f00\u53d1")) {
    return <IconTerminal2 className="size-3" />
  }

  if (tag.includes("\u5ba1\u67e5") || tag.includes("review")) {
    return <IconBug className="size-3" />
  }

  if (tag.includes("\u6d4b\u8bd5") || tag.includes("test")) {
    return <IconTestPipe className="size-3" />
  }

  if (tag.includes("\u6587\u6863")) {
    return <IconFileText className="size-3" />
  }

  if (tag.includes("\u67b6\u6784")) {
    return <IconAssembly className="size-3" />
  }

  return <IconPuzzle className="size-3" />
}
