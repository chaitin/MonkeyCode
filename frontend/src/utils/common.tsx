import { Badge } from "@/components/ui/badge"
import { Folder } from "lucide-react"
import Icon from "@/components/common/Icon"
import { IconAssembly, IconBrandChrome, IconBrandPython, IconBug, IconCircleCheckFilled, IconCircleXFilled, IconDeviceGamepad2, IconFileText, IconHelpHexagon, IconPalette, IconPuzzle, IconShieldChevron, IconTerminal2, IconTestPipe } from "@tabler/icons-react"
import Cap from "@cap.js/widget"
import { HoverCardContent } from "@/components/ui/hover-card"
import { ConstsHostStatus, ConstsInterfaceType, ConstsOwnerType, ConstsProjectIssueStatus, GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, TypesVirtualMachineStatus, type DomainHost, type DomainImage, type DomainModel, type DomainOwner, type DomainProviderModelListItem, type DomainVirtualMachine, type GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition } from "@/api/Api"
import { apiRequest } from "./requestUtils"
import { remark } from "remark"
import strip from "strip-markdown"
import streamSaver from "streamsaver"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import dayjs from "dayjs"

/** GitHub App 安装地址：https://monkeycode-ai.com 用正式环境，其他域名用开发环境 */
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
    return <Badge variant="destructive">离线</Badge>
  }
  return <Badge variant="outline">未知</Badge>
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

  // 按顺序检查支持的操作系统
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

  // 如果都匹配不到，fallback 到 linux
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

  return 'openai';
}

export function formatMemory(bytes?: number): string {
  if (!bytes) return "未知"
  const gb = bytes / (1024 * 1024 * 1024)
  return `${Math.ceil(gb)} GB`
}


export function humanTime(seconds: number): string {
  seconds = seconds > 0 ? seconds : 0;
  
  if (seconds < 60) { 
    return `${Math.floor(seconds)} 秒`;
  } else if (seconds < 60 * 60) { 
    return `${Math.floor(seconds / 60)} 分钟`;
  } else if (seconds < 60 * 60 * 24) { 
    return `${Math.floor(seconds / 60 / 60)} 小时`;
  } else { 
    return `${Math.floor(seconds / 60 / 60 / 24)} 天`;
  } 
};

export function translateStatus(status?: TypesVirtualMachineStatus): string {
  switch (status) {
    case TypesVirtualMachineStatus.VirtualMachineStatusOnline:
      return '正在运行'
    case TypesVirtualMachineStatus.VirtualMachineStatusPending:
      return '正在准备'
    case TypesVirtualMachineStatus.VirtualMachineStatusOffline:
      return '已离线'
    default:
      return status || '未知'
  }
}

export function getStatusBadgeProps(status?: TypesVirtualMachineStatus) {
  switch (status) {
    case TypesVirtualMachineStatus.VirtualMachineStatusOnline:
      return { variant: 'default' as const, className: 'cursor-default' }
    case TypesVirtualMachineStatus.VirtualMachineStatusPending:
      return { variant: 'default' as const, className: 'cursor-default' }
    case TypesVirtualMachineStatus.VirtualMachineStatusOffline:
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
    default:
      return <Icon name="GitHub-Uncolor" className="size-4" />
  }
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
    default:
      return <IconHelpHexagon className="size-4" />
  }
}

export function getTaskStatusText(status?: string): string {
  switch (status) {
    case 'started':
      return '正在执行任务'
    case 'pending':
      return '正在为任务准备开发环境'
    case 'stopped':
      return '任务已终止'
    case 'ended':
      return '请继续对话'
    case 'error':
      return '任务发生错误'
    case 'finished':
      return '任务已结束'
    default:
      return '任务状态未知'
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


// 验证邮箱格式
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
      return "进行中"
    case ConstsProjectIssueStatus.ProjectIssueStatusCompleted:
      return "已完成"
    case ConstsProjectIssueStatus.ProjectIssueStatusClosed:
      return "已关闭"
    default:
      return "未知"
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
      return <Badge variant="secondary">个人</Badge>
    case ConstsOwnerType.OwnerTypeTeam:
      return <Badge variant="secondary">{owner?.name}</Badge>
    case ConstsOwnerType.OwnerTypePublic:
      return <Badge variant="secondary">公共</Badge>
    default:
      return null
  }
}

export function getModelHealthBadge(model?: DomainModel): React.ReactNode {
  if (!model) {
    return null
  }

  return <Tooltip>
    <TooltipTrigger asChild>
      {model.last_check_success ? (
        <IconCircleCheckFilled className="text-teal-500 size-4 shrink-0" />
      ) : (
        <IconCircleXFilled className="text-red-500 size-4 shrink-0" />
      )}
    </TooltipTrigger>
    <TooltipContent>
      {model.last_check_at ? (
        <p>检测于 {dayjs(model.last_check_at * 1000).fromNow()}</p>
      ) : (
        <p>尚未进行健康检查</p>
      )}
      {model.last_check_error && <p className="max-w-xl break-all whitespace-pre-wrap mt-2">
        {model.last_check_error}
      </p>}
    </TooltipContent>
  </Tooltip>

  return <Badge variant="secondary">1231</Badge>
}

export function getHostBadges(host?: DomainHost): React.ReactNode {
  if (!host) {
    return null
  }

  return <>
    {getHostStatusBadge(host.status)}
    {host.is_default && <Badge>默认</Badge>}
    {getOwnerTypeBadge(host.owner)}
    {host.arch !== 'x86_64' && <Badge variant="secondary" className="hidden sm:inline">{host.arch}</Badge>}
    <Badge variant="secondary" className="hidden sm:inline">{host.cores} 核</Badge>
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
    return '未知状态'
  }

  const lastCondition = conditions?.[conditions.length - 1]
  switch (lastCondition?.type) {
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeScheduled:
      return '正在初始化'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeImagePulled:
      return '正在拉取系统镜像'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeProjectCloned:
      return '正在克隆代码仓库'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeImageBuilt:
      return '正在构建系统镜像'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeContainerCreated:
      return '正在创建开发环境'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeContainerStarted:
      return '正在启动开发环境'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeReady:
      return '开发环境已准备好'
    case GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed:
      return '无法创建开发环境'
    default:
      return '未知状态'
  }
}

export function getFileName(path: string): string {
  return path.split('/').pop() || ''
}

/**
 * 将文件列表打包成 zip 文件
 * @param files 文件列表
 * @param zipFilename 打包后的 zip 文件名，默认为 'project-files.zip'
 * @returns 打包后的 zip File 对象
 */
export async function packFilesAsZip(
  files: File[],
  zipFilename: string = 'project-files.zip'
): Promise<File> {
  if (files.length === 0) {
    throw new Error('文件列表不能为空')
  }

  // 如果只有一个文件且是 zip 格式，直接返回，不需要重新打包
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return files[0]
  }

  // 动态导入 JSZip 并打包
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  for (const file of files) {
    zip.file(file.name, file)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  return new File([zipBlob], zipFilename, { type: 'application/zip' })
}

/**
 * 将文件列表打包成 zip 并上传
 * @param files 文件列表
 * @param zipFilename 打包后的 zip 文件名，默认为 'project-files.zip'
 * @returns 上传成功后的访问地址和文件名，失败时抛出错误
 */
export async function packAndUploadFilesAsZip(
  files: File[],
  zipFilename: string = 'project-files.zip'
): Promise<{ accessUrl: string; filename: string }> {
  const zipFile = await packFilesAsZip(files, zipFilename)

  // 获取预签名上传地址
  const presignResult = await new Promise<{ upload_url: string; access_url: string }>((resolve, reject) => {
    apiRequest('v1UploaderPresignCreate', {
      filename: zipFile.name,
      usage: 'repo',
      expires: 600,
    }, [], (resp) => {
      if (resp.code === 0 && resp.data?.upload_url && resp.data?.access_url) {
        resolve({ upload_url: resp.data.upload_url, access_url: resp.data.access_url })
      } else {
        reject(new Error('获取上传地址失败: ' + (resp.message || '未知错误')))
      }
    }, (error) => {
      reject(error)
    })
  })

  const { upload_url, access_url } = presignResult

  // 上传文件
  const uploadResponse = await fetch(upload_url, {
    method: 'PUT',
    body: zipFile,
    headers: {
      'Content-Type': 'application/zip',
    },
  })

  if (!uploadResponse.ok) {
    throw new Error('文件上传失败: ' + uploadResponse.statusText)
  }

  return {
    accessUrl: access_url,
    filename: zipFile.name,
  }
}

/**
 * 将 markdown 文本转换为纯文字，去掉所有格式标记
 * @param markdown markdown 原文
 * @returns 去掉格式后的纯文字内容
 */
export function stripMarkdown(markdown: string | undefined): string {
  if (!markdown) {
    return ''
  }

  const result = remark().use(strip).processSync(markdown)
  return String(result).trim()
}

/**
 * 根据文件名获取扩展名（小写）
 * @param filename 文件名
 * @returns 小写的扩展名（不含点），如果没有扩展名则返回空字符串
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

export function selectModel(models: DomainModel[], followDefault: boolean = true): string {
  const defaultModelId = models.find(model => model.is_default)?.id

  if (followDefault) {
    if (defaultModelId) {
      return defaultModelId
    }
    return 'economy'
  }

  return 'economy'
}


export function selectHost(hosts: DomainHost[], followDefault: boolean = true): string {
  const onlineHosts = hosts.filter(host => host.status === ConstsHostStatus.HostStatusOnline);
  let result = 'public_host'

  if (followDefault) {
    result = onlineHosts.find(host => host.is_default)?.id || onlineHosts[0]?.id || result
  }

  return result
}

export function selectImage(images: DomainImage[], followDefault: boolean = true): string {
  let result = ''

  result = images.find(image => {
    return image.owner?.type === ConstsOwnerType.OwnerTypePublic && image.remark === 'devbox'
  })?.id || result

  if (followDefault) {
    result = images.find(image => image.is_default)?.id || result
  }

  return result
}

/**
 * 下载文件（流式下载，不占用内存）
 * @param envid 环境 ID
 * @param path 文件路径
 * @param filename 下载时的文件名（可选，默认从路径中提取）
 * @throws 网络错误或下载失败时抛出错误
 */
export async function downloadFile(envid: string, path: string, filename?: string): Promise<void> {
  const url = `/api/v1/users/files/download?id=${encodeURIComponent(envid)}&path=${encodeURIComponent(path)}`
  
  const response = await fetch(url)
  
  // 检查 x-internal-error header，如果存在则表示下载失败
  const internalError = response.headers.get('x-internal-error')
  if (internalError) {
    throw new Error(b64decode(internalError))
  }
  
  if (!response.body) {
    throw new Error('无法获取文件流')
  }
  
  const downloadFilename = filename || getFileName(path)
  const contentLength = response.headers.get('content-length')
  
  // 创建可写流，直接写入磁盘（流式下载）
  const fileStream = streamSaver.createWriteStream(downloadFilename, {
    size: contentLength ? Number(contentLength) : undefined
  })
  
  // 将 response body 流式写入文件
  await response.body.pipeTo(fileStream)
}


export function getModelUrlDescription(baseUrl: string, interfaceType: ConstsInterfaceType): string {
  let url = baseUrl.trim()

  if (!url) {
    return "未设置模型 API 地址"
  }

  if (!url.endsWith('/')) {
    url += '/'
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return '模型地址不合法'
  }

  switch (interfaceType) {
    case ConstsInterfaceType.InterfaceTypeOpenAIResponse:
      return url + "responses"
    case ConstsInterfaceType.InterfaceTypeOpenAIChat:
      return url + "chat/completions"
    case ConstsInterfaceType.InterfaceTypeAnthropic:
      return url + "v1/messages"
    default:
      return '模型地址不合法'
  }
}

/**
 * 深拷贝合并对象
 * 递归地合并两个对象，对于嵌套对象会进行深度合并
 * @param target 目标对象
 * @param source 源对象，其属性会合并到目标对象中
 * @returns 合并后的新对象
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
        // 如果两个值都是普通对象，递归合并
        result[key] = deepMerge(targetValue, sourceValue) as T[Extract<keyof T, string>]
      } else {
        // 否则直接覆盖
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }
  
  return result
}



export const modelProviderList: Record<string, DomainProviderModelListItem[]> = {
  "https://api.minimax.io/v1": [
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2.1-lightning"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimax.io/anthropic": [
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2.1-lightning"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimaxi.com/v1": [
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2.1-lightning"},
    {"model": "MiniMax-M2"}
  ],
  "https://api.minimaxi.com/anthropic": [
    {"model": "MiniMax-M2.7"},
    {"model": "MiniMax-M2.5"},
    {"model": "MiniMax-M2.1"},
    {"model": "MiniMax-M2.1-lightning"},
    {"model": "MiniMax-M2"}
  ]
}

export function getSkillTagIcon(tag: string): React.ReactNode {
  tag = tag.toLowerCase();

  if (tag.includes("ui") || tag.includes("ux") || tag.includes("视觉")) {
    return <IconPalette className="size-3" />
  }

  if (tag.includes("python")) {
    return <IconBrandPython className="size-3" />
  }
  
  if (tag.includes("前端")) {
    return <IconBrandChrome className="size-3" />
  }
  
  if (tag.includes("游戏")) {
    return <IconDeviceGamepad2 className="size-3" />
  }

  if (tag.includes("审计") || tag.includes("安全")) {
    return <IconShieldChevron className="size-3" />
  }

  if (tag.includes("开发")) {
    return <IconTerminal2 className="size-3" />
  }

  if (tag.includes("审查") || tag.includes("review")) {
    return <IconBug className="size-3" />
  }

  if (tag.includes("测试") || tag.includes("test")) {
    return <IconTestPipe className="size-3" />
  }

  if (tag.includes("文档")) {
    return <IconFileText className="size-3" />
  }

  if (tag.includes("架构")) {
    return <IconAssembly className="size-3" />
  }

  return <IconPuzzle className="size-3" />
}