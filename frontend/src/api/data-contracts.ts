/* eslint-disable */
/* tslint:disable */
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export enum ConstsCliName {
  CliNameCodex = "codex",
  CliNameClaude = "claude",
  CliNameOpencode = "opencode",
}

export enum ConstsFeedbackStatus {
  FeedbackStatusPending = "pending",
  FeedbackStatusProcessing = "processing",
  FeedbackStatusResolved = "resolved",
  FeedbackStatusClosed = "closed",
}

export enum ConstsFeedbackType {
  FeedbackTypeBug = "bug",
  FeedbackTypeSuggestion = "suggestion",
  FeedbackTypeOther = "other",
}

export enum ConstsFileKind {
  FileKindUnknown = "unknown",
  FileKindFile = "file",
  FileKindDir = "dir",
  FileKindSymlink = "symlink",
}

export enum ConstsGitPlatform {
  GitPlatformGithub = "github",
  GitPlatformGitLab = "gitlab",
  GitPlatformGitea = "gitea",
  GitPlatformGitee = "gitee",
  GitPlatformInternal = "internal",
}

export enum ConstsHostStatus {
  HostStatusOnline = "online",
  HostStatusOffline = "offline",
}

export enum ConstsInterfaceType {
  InterfaceTypeOpenAIChat = "openai_chat",
  InterfaceTypeOpenAIResponse = "openai_responses",
  InterfaceTypeAnthropic = "anthropic",
}

export enum ConstsModelProvider {
  ModelProviderSiliconFlow = "SiliconFlow",
  ModelProviderOpenAI = "OpenAI",
  ModelProviderOllama = "Ollama",
  ModelProviderDeepSeek = "DeepSeek",
  ModelProviderMoonshot = "Moonshot",
  ModelProviderAzureOpenAI = "AzureOpenAI",
  ModelProviderBaiZhiCloud = "BaiZhiCloud",
  ModelProviderHunyuan = "Hunyuan",
  ModelProviderBaiLian = "BaiLian",
  ModelProviderVolcengine = "Volcengine",
  ModelProviderGoogle = "Gemini",
}

export enum ConstsOwnerType {
  OwnerTypePrivate = "private",
  OwnerTypePublic = "public",
  OwnerTypeTeam = "team",
}

export enum ConstsPlaygroundAuditStatus {
  AuditStatusSubmit = "submit",
  AuditStatusApproved = "approved",
  AuditStatusRejected = "rejected",
  AuditStatusWithdraw = "withdraw",
}

export enum ConstsPlaygroundItemStatus {
  PlaygroundItemStatusUnPublish = "unpublish",
  PlaygroundItemStatusPublished = "published",
}

export enum ConstsPortStatus {
  PortStatusReversed = "reserved",
  PortStatusConnected = "connected",
}

export enum ConstsPostKind {
  PostKindTask = "task",
  PostKindProject = "project",
  PostKindNormal = "normal",
}

export enum ConstsProjectCollaboratorRole {
  ProjectCollaboratorRoleReadOnly = "read_only",
  ProjectCollaboratorRoleReadWrite = "read_write",
}

export enum ConstsProjectIssuePriority {
  ProjectIssuePriorityOne = 1,
  ProjectIssuePriorityTwo = 2,
  ProjectIssuePriorityThree = 3,
}

export enum ConstsProjectIssueStatus {
  ProjectIssueStatusOpen = "open",
  ProjectIssueStatusClosed = "closed",
  ProjectIssueStatusCompleted = "completed",
}

export enum ConstsTaskStatus {
  TaskStatusPending = "pending",
  TaskStatusProcessing = "processing",
  TaskStatusError = "error",
  TaskStatusFinished = "finished",
}

export enum ConstsTaskSubType {
  TaskSubTypeGenerateDocs = "generate_docs",
  TaskSubTypeGenerateRequirement = "generate_requirement",
  TaskSubTypeGenerateDesign = "generate_design",
  TaskSubTypeGenerateTasklist = "generate_tasklist",
  TaskSubTypeExecuteTask = "execute_task",
  TaskSubTypePrReview = "pr_review",
}

export enum ConstsTaskType {
  TaskTypeDevelop = "develop",
  TaskTypeDesign = "design",
  TaskTypeReview = "review",
}

export enum ConstsTeamMemberRole {
  TeamMemberRoleAdmin = "admin",
  TeamMemberRoleUser = "user",
}

export enum ConstsTerminalMode {
  TerminalModeReadOnly = "read_only",
  TerminalModeReadWrite = "read_write",
}

export enum ConstsTransactionKind {
  TransactionKindSignupBonus = "signup_bonus",
  TransactionKindVoucherExchange = "voucher_exchange",
  TransactionKindVMConsumption = "vm_consumption",
  TransactionKindModelConsumption = "model_consumption",
  TransactionKindInvitationReward = "invitation_reward",
}

export enum ConstsUploadUsage {
  UploadUsageAvatar = "avatar",
  UploadUsageSpec = "spec",
  UploadUsageRepo = "repo",
}

export enum ConstsUserPlatform {
  UserPlatformBaizhi = "baizhi",
  UserPlatformGithub = "github",
  UserPlatformGitLab = "gitlab",
  UserPlatformGitea = "gitea",
  UserPlatformGitee = "gitee",
}

export enum ConstsUserRole {
  UserRoleIndividual = "individual",
  UserRoleEnterprise = "enterprise",
  UserRoleSubAccount = "subaccount",
  UserRoleAdmin = "admin",
  UserRoleGitTask = "gittask",
}

export enum ConstsUserStatus {
  UserStatusActive = "active",
  UserStatusInactive = "inactive",
}

export interface Dbv2Cursor {
  /** 游标 */
  cursor?: string;
  /** 是否有下一页 */
  has_next_page?: boolean;
}

export interface Dbv2PageInfo {
  has_next_page?: boolean;
  next_token?: string;
  total_count?: number;
}

export interface DomainAddGitIdentityReq {
  access_token: string;
  base_url: string;
  email: string;
  platform: ConstsGitPlatform;
  remark?: string;
  username: string;
}

export interface DomainAddTeamAdminReq {
  /** 邮箱 */
  email: string;
  /** 姓名 */
  name: string;
}

export interface DomainAddTeamAdminResp {
  user?: DomainTeamUser;
}

export interface DomainAddTeamGroupReq {
  name: string;
}

export interface DomainAddTeamGroupUsersReq {
  user_ids: string[];
}

export interface DomainAddTeamGroupUsersResp {
  users?: DomainUser[];
}

export interface DomainAddTeamImageReq {
  group_ids: string[];
  name: string;
  remark?: string;
}

export interface DomainAddTeamModelReq {
  api_key: string;
  base_url: string;
  group_ids: string[];
  interface_type: "openai_chat" | "openai_responses" | "anthropic";
  model: string;
  provider: string;
  temperature?: number;
}

export interface DomainAddTeamOAuthSiteReq {
  base_url: string;
  client_id: string;
  client_secret: string;
  name: string;
  platform: "gitlab" | "gitea";
  proxy_url?: string;
}

export interface DomainAddTeamUserReq {
  /** 邮箱列表 */
  emails: string[];
  /** 团队组ID */
  group_id?: string;
}

export interface DomainAddTeamUserResp {
  users?: DomainTeamUser[];
}

export interface DomainApplyPortReq {
  /** 转发 id */
  forward_id?: string;
  /**
   * 端口号，范围 1-65535
   * @min 1
   * @max 65535
   */
  port: number;
  /** IP 白名单列表 */
  white_list: string[];
}

export interface DomainAudit {
  created_at?: string;
  id?: string;
  operation?: string;
  request?: string;
  response?: string;
  source_ip?: string;
  user?: DomainUser;
  user_agent?: string;
}

export interface DomainAuthRepository {
  description?: string;
  full_name?: string;
  url?: string;
}

export interface DomainBranch {
  name?: string;
}

export interface DomainChangePasswordReq {
  /** 当前密码 */
  current_password?: string;
  /**
   * 新密码
   * @minLength 8
   * @maxLength 32
   */
  new_password: string;
}

export interface DomainCheckByConfigReq {
  api_key: string;
  base_url: string;
  interface_type?: "openai_chat" | "openai_responses" | "anthropic";
  model: string;
  provider: ConstsModelProvider;
}

export interface DomainCheckModelResp {
  error?: string;
  success?: boolean;
}

export interface DomainCollaborator {
  avatar_url?: string;
  email?: string;
  id?: string;
  /** 用户绑定的身份列表，例如 github, gitlab */
  identities?: DomainUserIdentity[];
  is_blocked?: boolean;
  name?: string;
  /** 权限 */
  permission?: ConstsProjectCollaboratorRole;
  role?: ConstsUserRole;
  status?: ConstsUserStatus;
  team?: DomainTeam;
  token?: string;
}

export interface DomainCreateCollaboratorItem {
  /** 权限 */
  permission?: ConstsProjectCollaboratorRole;
  /** 用户ID */
  user_id?: string;
}

export interface DomainCreateFeedbackReq {
  content: string;
  title: string;
  type: "bug" | "suggestion" | "other";
}

export interface DomainCreateGitBotReq {
  host_id: string;
  name?: string;
  platform: ConstsGitPlatform;
  token: string;
}

export interface DomainCreateImageReq {
  image_name: string;
  is_default?: boolean;
  remark?: string;
}

export interface DomainCreateIssueCommentReq {
  /** 评论内容 */
  comment: string;
  /** 父评论ID（可选，用于回复） */
  parent_id?: string;
}

export interface DomainCreateIssueReq {
  /** 指派用户ID */
  assignee_id?: string;
  /** 问题优先级, 1, 2, 3 */
  priority?: ConstsProjectIssuePriority;
  /** 问题描述 */
  requirement_document?: string;
  /** 问题标题 */
  title?: string;
}

export interface DomainCreateModelReq {
  api_key: string;
  base_url: string;
  interface_type: "openai_chat" | "openai_responses" | "anthropic";
  is_default?: boolean;
  model: string;
  provider: string;
  temperature?: number;
}

export interface DomainCreateProjectReq {
  /** 项目描述 */
  description?: string;
  /** 关联的 git identity id */
  git_identity_id?: string;
  /** 项目名 */
  name?: string;
  /** 项目平台 */
  platform?: ConstsGitPlatform;
  /** 项目仓库URL */
  repo_url?: string;
}

export interface DomainCreateTaskReq {
  /** 客户端名称 codex | claude | opencode */
  cli_name?: ConstsCliName;
  /** 任务内容 */
  content: string;
  /** 额外参数 */
  extra?: DomainTaskExtraConfig;
  /** Git 身份ID */
  git_identity_id?: string;
  /** 宿主机 id, 当 host_id 为 public_host 时使用公共宿主机 */
  host_id: string;
  /** 镜像ID */
  image_id: string;
  /** 模型ID premium: 指定用贵的模型 economy: 指定用便宜的模型 */
  model_id: string;
  /** 仓库信息 */
  repo: DomainTaskRepoReq;
  /** 资源配置 */
  resource: DomainVMResource;
  sub_type?: ConstsTaskSubType;
  system_prompt?: string;
  /** 任务类型 */
  task_type?: ConstsTaskType;
}

export interface DomainCreateVMReq {
  /** Git 身份 ID */
  git_identity_id?: string;
  /** 宿主机 id, 当 host_id 为 public_host 时使用公共宿主机 */
  host_id: string;
  /** 镜像 id, 这里指的是images列表接口返回的id */
  image_id: string;
  /** 是否安装 AI Coding 工具集，如 Qwen Code, Codex, Gemini Cli 等 */
  install_coding_agents?: boolean;
  /** 过期时间: 倒计时时间，以秒为单位, 0 表示永不过期 */
  life?: number;
  /** 模型ID premium: 指定用贵的模型 economy: 指定用便宜的模型 */
  model_id: string;
  /** 宿主机名称 */
  name: string;
  /** 仓库请求 */
  repo?: DomainTaskRepoReq;
  /** 资源配置 */
  resource: DomainResource;
}

export interface DomainDeleteImageReq {
  id: string;
}

export interface DomainExchangeReq {
  /** 兑换码 */
  code?: string;
}

export interface DomainFeedback {
  content?: string;
  created_at?: number;
  id?: string;
  status?: ConstsFeedbackStatus;
  title?: string;
  type?: ConstsFeedbackType;
  updated_at?: number;
  user?: DomainUser;
}

export interface DomainFileChangeReq {
  /** 虚拟机 id */
  id: string;
  /** 来源 */
  source: string;
  /** 目标 */
  target: string;
}

export interface DomainFilePathReq {
  /** 虚拟机 id */
  id: string;
  /** 文件/目录路径 */
  path: string;
}

export interface DomainFileSaveReq {
  /** 文件内容 */
  content?: string;
  /** 虚拟机 id */
  id: string;
  /** 文件路径 */
  path: string;
}

export interface DomainGetProviderModelListResp {
  error?: DomainOpenAIError;
  models?: DomainProviderModelListItem[];
}

export interface DomainGitBot {
  created_at?: number;
  /** 主机 */
  host?: DomainHost;
  id?: string;
  /** 名称 */
  name?: string;
  /** 平台 */
  platform?: ConstsGitPlatform;
  /** secret token */
  secret_token?: string;
  /** access token */
  token?: string;
  /** 可查看任务的用户列表 */
  users?: DomainUser[];
  /** webhook */
  webhook_url?: string;
}

export interface DomainGitBotTask {
  /** bot 信息 */
  bot?: DomainGitBot;
  created_at?: number;
  /** id */
  id?: string;
  /** pr/mr 信息 */
  pull_request?: DomainPullRequest;
  /** 仓库 */
  repo?: DomainGitRepository;
  /** 任务状态 */
  status?: ConstsTaskStatus;
}

export interface DomainGitIdentity {
  access_token?: string;
  authorized_repositories?: DomainAuthRepository[];
  base_url?: string;
  created_at?: string;
  email?: string;
  id?: string;
  is_installation_app?: boolean;
  platform?: ConstsGitPlatform;
  remark?: string;
  username?: string;
}

export interface DomainGitRepository {
  owner?: string;
  platform?: ConstsGitPlatform;
  repo_name?: string;
  url?: string;
}

export interface DomainHost {
  arch?: string;
  cores?: number;
  default?: boolean;
  external_ip?: string;
  groups?: DomainTeamGroup[];
  id?: string;
  is_default?: boolean;
  memory?: number;
  name?: string;
  os?: string;
  owner?: DomainOwner;
  remark?: string;
  status?: ConstsHostStatus;
  version?: string;
  virtualmachines?: DomainVirtualMachine[];
  weight?: number;
}

export interface DomainHostListResp {
  hosts?: DomainHost[];
}

export interface DomainImage {
  created_at?: number;
  id?: string;
  is_default?: boolean;
  name?: string;
  owner?: DomainOwner;
  remark?: string;
}

export interface DomainInstallCommand {
  command?: string;
}

export interface DomainListAuditsResponse {
  audits?: DomainAudit[];
  page?: Dbv2Cursor;
}

export interface DomainListCollaboratorsResp {
  /** 协作者列表 */
  collaborators?: DomainCollaborator[];
}

export interface DomainListFeedbacksResp {
  feedbacks?: DomainFeedback[];
  page?: Dbv2Cursor;
}

export interface DomainListGitBotResp {
  bots?: DomainGitBot[];
}

export interface DomainListGitBotTaskResp {
  /** 分页信息 */
  page_info?: Dbv2PageInfo;
  tasks?: DomainGitBotTask[];
}

export interface DomainListImageResp {
  images?: DomainImage[];
  /** 游标信息 */
  page?: Dbv2Cursor;
}

export interface DomainListIssueCommentsResp {
  /** 评论列表 */
  comments?: DomainProjectIssueComment[];
  /** 游标信息 */
  page?: Dbv2Cursor;
}

export interface DomainListIssuesResp {
  /** 问题列表 */
  issues?: DomainProjectIssue[];
  /** 游标信息 */
  page?: Dbv2Cursor;
}

export interface DomainListModelResp {
  models?: DomainModel[];
  /** 游标信息 */
  page?: Dbv2Cursor;
}

export interface DomainListPlaygroundPostResp {
  /** 游标信息 */
  page?: Dbv2Cursor;
  /** 广场帖子列表 */
  playground_posts?: DomainPlaygroundPost[];
}

export interface DomainListProjectResp {
  /** 游标信息 */
  page?: Dbv2Cursor;
  /** 项目列表 */
  projects?: DomainProject[];
}

export interface DomainListTaskResp {
  /** 游标信息（游标分页时返回） */
  page?: Dbv2Cursor;
  /** 分页信息（page/size 分页时返回） */
  page_info?: Dbv2PageInfo;
  /** 任务列表 */
  tasks?: DomainProjectTask[];
}

export interface DomainListTeamGroupsResp {
  groups?: DomainTeamGroup[];
}

export interface DomainListTeamHostsResp {
  hosts?: DomainHost[];
}

export interface DomainListTeamImagesResp {
  images?: DomainTeamImage[];
}

export interface DomainListTeamModelsResp {
  models?: DomainTeamModel[];
}

export interface DomainListTeamOAuthSitesResp {
  sites?: DomainTeamOAuthSite[];
}

export interface DomainListTransactionResp {
  /** 分页信息 */
  page?: Dbv2PageInfo;
  transactions?: DomainTransactionLog[];
}

export interface DomainListUserPlaygroundPostResp {
  /** 游标信息 */
  page?: Dbv2Cursor;
  /** 广场帖子列表 */
  playground_posts?: DomainPlaygroundPost[];
}

export interface DomainMemberListResp {
  member_limit?: number;
  members?: DomainTeamMemberInfo[];
}

export interface DomainModel {
  api_key?: string;
  base_url?: string;
  created_at?: number;
  id?: string;
  interface_type?: ConstsInterfaceType;
  is_default?: boolean;
  last_check_at?: number;
  last_check_error?: string;
  last_check_success?: boolean;
  model?: string;
  owner?: DomainOwner;
  provider?: string;
  temperature?: number;
  updated_at?: number;
}

export interface DomainOAuthURLResp {
  url?: string;
}

export interface DomainOpenAIError {
  message?: string;
  type?: string;
}

export interface DomainOwner {
  id?: string;
  name?: string;
  type?: ConstsOwnerType;
}

export interface DomainPlaygroundAuditLog {
  /** 创建时间 */
  created_at?: number;
  /** 审计日志ID */
  id?: string;
  /** 原因 */
  reason?: string;
  /** 状态 */
  status?: ConstsPlaygroundAuditStatus;
}

export interface DomainPlaygroundNormalPost {
  /** 代码 */
  code?: string;
  /** 内容 */
  content?: string;
  /** 普通帖子ID */
  id?: string;
  /** 图片列表 */
  images?: string[];
  /** 广场帖子ID */
  playground_post_id?: string;
  /** 标题 */
  title?: string;
}

export interface DomainPlaygroundPost {
  /** 审计日志 */
  audit_log?: DomainPlaygroundAuditLog;
  /** 创建时间 */
  created_at?: number;
  /** 帖子ID */
  id?: string;
  /** 帖子类型 */
  kind?: ConstsPostKind;
  /** 普通帖子 */
  normal_post?: DomainPlaygroundNormalPost;
  /** 状态 */
  status?: ConstsPlaygroundItemStatus;
  /** 任务帖子 */
  task_post?: DomainPlaygroundTaskPost;
  /** 更新时间 */
  updated_at?: number;
  /** 用户信息 */
  user?: DomainUser;
  /** 浏览次数 */
  views?: number;
}

export interface DomainPlaygroundTaskPost {
  /** CLI 名称 */
  cli?: ConstsCliName;
  /** 代码 */
  code?: string;
  /** 内容 */
  content?: string;
  /** 创建时间 */
  created_at?: number;
  /** 任务帖子ID */
  id?: string;
  /** 图片列表 */
  images?: string[];
  /** 广场帖子ID */
  playground_post_id?: string;
  /** 任务信息 */
  task_id?: string;
  /** 标题 */
  title?: string;
  /** 更新时间 */
  updated_at?: number;
}

export interface DomainPresignReq {
  /** 预签名URL过期时间(秒)，默认600秒(10分钟)，最大604800秒(7天) */
  expires?: number;
  /** 文件名 */
  filename: string;
  /** 上传用途枚举: avatar(头像), spec(规格), repo(仓库) */
  usage: "avatar" | "spec" | "repo";
}

export interface DomainPresignResp {
  /** 文件访问URL */
  access_url?: string;
  /** 预签名上传URL，使用PUT方法上传 */
  upload_url?: string;
}

export interface DomainProject {
  /** 协作者列表 */
  collaborators?: DomainCollaborator[];
  /** 创建时间 */
  created_at?: number;
  /** 项目描述 */
  description?: string;
  /** 项目关联的 git identity id */
  git_identity_id?: string;
  /** 项目ID */
  id?: string;
  /** 问题列表 */
  issues?: DomainProjectIssue[];
  /** 项目名 */
  name?: string;
  /** 未解决问题数量 */
  open_issue_count?: number;
  /** 项目平台 */
  platform?: ConstsGitPlatform;
  /** 项目仓库URL */
  repo_url?: string;
  /** 更新时间 */
  updated_at?: number;
  /** 用户信息 */
  user?: DomainUser;
}

export interface DomainProjectBlob {
  /** 文件内容 */
  content?: number[];
  /** 是否为二进制文件 */
  is_binary?: boolean;
  /** SHA */
  sha?: string;
  /** 文件大小 */
  size?: number;
}

export interface DomainProjectCommit {
  author?: DomainProjectCommitUser;
  committer?: DomainProjectCommitUser;
  message?: string;
  parent_shas?: string[];
  sha?: string;
  tree_sha?: string;
}

export interface DomainProjectCommitEntry {
  commit?: DomainProjectCommit;
}

export interface DomainProjectCommitUser {
  email?: string;
  name?: string;
  when?: number;
}

export interface DomainProjectIssue {
  /** 指派用户信息 */
  assignee?: DomainUser;
  /** 创建时间 */
  created_at?: number;
  /** 设计文档 */
  design_document?: string;
  /** 问题ID */
  id?: string;
  /** 问题优先级 */
  priority?: ConstsProjectIssuePriority;
  /** 问题描述 */
  requirement_document?: string;
  /** 问题状态 */
  status?: ConstsProjectIssueStatus;
  /** 问题摘要 */
  summary?: string;
  /** 问题标题 */
  title?: string;
  /** 用户信息 */
  user?: DomainUser;
}

export interface DomainProjectIssueComment {
  /** 评论内容 */
  comment?: string;
  /** 创建时间 */
  created_at?: number;
  /** 用户信息 */
  creator?: DomainUser;
  /** 评论ID */
  id?: string;
  /** 父级评论信息（用于引用式展示） */
  parent?: DomainProjectIssueComment;
  /** 子评论列表（用于树形展示） */
  replies?: DomainProjectIssueComment[];
}

export interface DomainProjectLogs {
  /** 总数 */
  count?: number;
  /** 日志条目 */
  entries?: DomainProjectCommitEntry[];
}

export interface DomainProjectTask {
  branch?: string;
  cli_name?: ConstsCliName;
  /** 完成时间 */
  completed_at?: number;
  /** 任务内容 */
  content?: string;
  /** 创建时间 */
  created_at?: number;
  /** 额外参数 */
  extra?: DomainTaskExtraConfig;
  id: string;
  identity?: DomainGitIdentity;
  image?: DomainImage;
  model?: DomainModel;
  repo_filename?: string;
  repo_url?: string;
  /** 任务状态 */
  status?: ConstsTaskStatus;
  /** 任务子类型 */
  sub_type?: ConstsTaskSubType;
  /** 任务摘要 */
  summary?: string;
  /** 任务类型 */
  type?: ConstsTaskType;
  /** 虚拟机 */
  virtualmachine?: DomainVirtualMachine;
}

export interface DomainProjectTreeEntry {
  last_modified_at?: number;
  mode?: number;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
}

export interface DomainProviderModelListItem {
  model?: string;
}

export interface DomainPullRequest {
  title?: string;
  url?: string;
}

export interface DomainRecyclePortReq {
  /** 转发 id */
  forward_id: string;
}

export interface DomainRedeemCaptchaReq {
  solutions?: number[];
  token?: string;
}

export interface DomainRepositoryItem {
  repo_filename?: string;
  repo_name?: string;
  repo_url?: string;
}

export interface DomainResetUserPasswordEmailReq {
  /** 验证码Token */
  captcha_token: string;
  /** 发送重置密码邮件的邮箱列表 */
  emails: string[];
}

export interface DomainResetUserPasswordReq {
  /**
   * 新密码
   * @minLength 8
   * @maxLength 32
   */
  new_password: string;
  /** 令牌 */
  token: string;
}

export interface DomainResource {
  cpu?: number;
  memory?: number;
}

export interface DomainShareGitBotReq {
  /** git bot ID */
  id?: string;
  /** 成员 ID 列表 */
  user_ids?: string[];
}

export interface DomainSharePostReq {
  /** 代码 */
  code?: string;
  /** 内容 */
  content: string;
  /** 图片列表 */
  images?: string[];
  /** 标题 */
  title: string;
}

export interface DomainSharePostResp {
  /** 广场帖子ID */
  id?: string;
}

export interface DomainShareTaskReq {
  /** 代码 */
  code?: string;
  /** 内容 */
  content: string;
  /** 图片列表 */
  images?: string[];
  /** 标题 */
  title: string;
}

export interface DomainShareTaskResp {
  /** 广场帖子ID */
  id?: string;
}

export interface DomainShareTerminalReq {
  /** 虚拟机 id */
  id: string;
  /** 终端模式，只读或读写. 默认为读写 */
  mode?: ConstsTerminalMode;
  /** 终端 id, 用于唯一标识一个 session */
  terminal_id?: string;
}

export interface DomainShareTerminalResp {
  /** 加入终端的密码 */
  password?: string;
}

export interface DomainSiteInfo {
  base_url?: string;
  name?: string;
  site_type?: string;
}

export interface DomainSitesResp {
  sites?: DomainSiteInfo[];
}

export interface DomainSkill {
  args_schema?: Record<string, any>;
  categories?: string[];
  content?: string;
  description?: string;
  id?: string;
  name?: string;
  skill_id?: string;
  tags?: string[];
}

export interface DomainSpeechRecognitionData {
  /**
   * 错误信息 (仅error类型)
   * @example "识别失败"
   */
  error?: string;
  /**
   * 是否为最终结果 (仅result类型)
   * @example false
   */
  is_final?: boolean;
  /**
   * 识别文本 (仅result类型)
   * @example "你好"
   */
  text?: string;
  /**
   * 时间戳 (仅result类型)
   * @example 1640995200000
   */
  timestamp?: number;
  /**
   * 数据类型: result, end, error
   * @example "result"
   */
  type?: string;
  /**
   * 用户ID (仅result类型)
   * @example "uuid"
   */
  user_id?: string;
}

export interface DomainSpeechRecognitionEvent {
  /** 事件数据 */
  data?: DomainSpeechRecognitionData;
  /** 事件类型: recognition, end, error */
  event?: string;
}

export interface DomainStats {
  /** @example 5672 */
  repo_stars?: number;
  /** @example 2847392 */
  tasks_count?: number;
  /** @example 18429 */
  users_count?: number;
}

export interface DomainTask {
  branch?: string;
  cli_name?: ConstsCliName;
  /** 完成时间 */
  completed_at?: number;
  /** 任务内容 */
  content?: string;
  /** 创建时间 */
  created_at?: number;
  /** 额外参数 */
  extra?: DomainTaskExtraConfig;
  id?: string;
  identity?: DomainGitIdentity;
  image?: DomainImage;
  model?: DomainModel;
  repo_filename?: string;
  repo_url?: string;
  /** 任务状态 */
  status?: ConstsTaskStatus;
  /** 任务子类型 */
  sub_type?: ConstsTaskSubType;
  /** 任务摘要 */
  summary?: string;
  /** 任务类型 */
  type?: ConstsTaskType;
  /** 虚拟机 */
  virtualmachine?: DomainVirtualMachine;
}

export interface DomainTaskExtraConfig {
  issue_id?: string;
  project_id?: string;
  /** Skill IDs 数组 */
  skill_ids?: string[];
}

export interface DomainTaskRepoReq {
  /** @default "master" */
  branch?: string;
  repo_filename?: string;
  repo_url?: string;
  zip_url?: string;
}

export interface DomainTeam {
  id?: string;
  name?: string;
}

export interface DomainTeamGroup {
  created_at?: number;
  id?: string;
  name?: string;
  updated_at?: number;
  users?: DomainUser[];
}

export interface DomainTeamImage {
  created_at?: number;
  groups?: DomainTeamGroup[];
  id?: string;
  name?: string;
  remark?: string;
  updated_at?: number;
}

export interface DomainTeamLoginReq {
  /** 验证码Token */
  captcha_token: string;
  /** 用户邮箱 */
  email: string;
  /** 用户密码（MD5加密后的值） */
  password: string;
}

export interface DomainTeamMember {
  team_id?: string;
  team_name?: string;
  team_role?: ConstsTeamMemberRole;
  user_id?: string;
}

export interface DomainTeamMemberInfo {
  created_at?: number;
  last_active_at?: number;
  role?: ConstsTeamMemberRole;
  user?: DomainUser;
}

export interface DomainTeamModel {
  api_key?: string;
  base_url?: string;
  created_at?: number;
  groups?: DomainTeamGroup[];
  id?: string;
  interface_type?: ConstsInterfaceType;
  last_check_at?: number;
  last_check_error?: string;
  last_check_success?: boolean;
  model?: string;
  provider?: string;
  temperature?: number;
  updated_at?: number;
}

export interface DomainTeamOAuthSite {
  base_url?: string;
  client_id?: string;
  client_secret?: string;
  created_at?: number;
  id?: string;
  name?: string;
  platform?: string;
  proxy_url?: string;
  site_type?: string;
  updated_at?: number;
}

export interface DomainTeamUser {
  team?: DomainTeam;
  user?: DomainUser;
}

export interface DomainTeamUserInfo {
  teams?: DomainTeamMember[];
  user?: DomainUser;
}

export interface DomainTerminal {
  /** 当前连接数 */
  connected_count?: number;
  /** 创建时间 */
  created_at?: number;
  /** 终端的 session id */
  id?: string;
  /** 终端的标题 */
  title?: string;
}

export interface DomainTransactionLog {
  /** 总金额 */
  amount?: number;
  /** 赠送金额变动 */
  amount_bonus?: number;
  /** 余额变动 */
  amount_principal?: number;
  /** 交易时间 */
  created_at?: number;
  /** 交易类型 */
  kind?: ConstsTransactionKind;
  /** 交易简介 */
  remark?: string;
}

export interface DomainUpdateGitBotReq {
  host_id?: string;
  id: string;
  name?: string;
  platform?: ConstsGitPlatform;
  token?: string;
}

export interface DomainUpdateGitIdentityReq {
  access_token?: string;
  base_url?: string;
  email?: string;
  platform?: ConstsGitPlatform;
  remark?: string;
  username?: string;
}

export interface DomainUpdateHostReq {
  /** 默认标签 */
  is_default?: boolean;
  /** 备注 */
  remark?: string;
  /**
   * 权重, 控制公共主机轮询
   * @min 1
   */
  weight?: number;
}

export interface DomainUpdateImageReq {
  image_name?: string;
  is_default?: boolean;
  remark?: string;
}

export interface DomainUpdateIssueReq {
  /** 指派用户ID */
  assignee_id?: string;
  /** 设计文档 */
  design_document?: string;
  /** 问题优先级, "one, two, three" */
  priority?: ConstsProjectIssuePriority;
  /** 问题描述 */
  requirement_document?: string;
  /** 问题状态 */
  status?: ConstsProjectIssueStatus;
  /** 问题标题 */
  title?: string;
}

export interface DomainUpdateModelReq {
  api_key?: string;
  base_url?: string;
  interface_type?: "openai_chat" | "openai_responses" | "anthropic";
  is_default?: boolean;
  model?: string;
  provider?: string;
  temperature?: number;
}

export interface DomainUpdateProjectReq {
  /** 创建协作者列表 */
  collaborators?: DomainCreateCollaboratorItem[];
  /** 项目描述 */
  description?: string;
  /** 项目名 */
  name?: string;
}

export interface DomainUpdateTeamGroupReq {
  name: string;
}

export interface DomainUpdateTeamHostReq {
  group_ids?: string[];
  remark?: string;
}

export interface DomainUpdateTeamImageReq {
  group_ids?: string[];
  name?: string;
  remark?: string;
}

export interface DomainUpdateTeamModelReq {
  api_key?: string;
  base_url?: string;
  group_ids?: string[];
  interface_type?: "openai_chat" | "openai_responses" | "anthropic";
  model?: string;
  provider?: string;
  temperature?: number;
}

export interface DomainUpdateTeamOAuthSiteReq {
  base_url?: string;
  client_id?: string;
  client_secret?: string;
  name?: string;
  proxy_url?: string;
}

export interface DomainUpdateTeamUserReq {
  is_blocked?: boolean;
}

export interface DomainUpdateTeamUserResp {
  user?: DomainUser;
}

export interface DomainUpdateUserResp {
  message?: string;
  success?: boolean;
  user?: DomainUser;
}

export interface DomainUpdateVMReq {
  /** 宿主机 id */
  host_id: string;
  /** 虚拟机 id */
  id: string;
  /**
   * 在原有时间上增加过期时间，单位为秒数
   * @min 3600
   */
  life?: number;
}

export interface DomainUser {
  avatar_url?: string;
  email?: string;
  id?: string;
  /** 用户绑定的身份列表，例如 github, gitlab */
  identities?: DomainUserIdentity[];
  is_blocked?: boolean;
  name?: string;
  role?: ConstsUserRole;
  status?: ConstsUserStatus;
  team?: DomainTeam;
  token?: string;
}

export interface DomainUserIdentity {
  avatar_url?: string;
  email?: string;
  id?: string;
  identity_id?: string;
  platform?: ConstsUserPlatform;
  username?: string;
}

export interface DomainVMPort {
  /** 错误信息 */
  error_message?: string;
  /** 转发 id */
  forward_id?: string;
  /** 端口号，范围 1-65535 */
  port?: number;
  /** 预览URL（可选） */
  preview_url?: string;
  /** 端口状态: reserved (仅本地监听), connected (已建立转发) */
  status?: ConstsPortStatus;
  /** 是否成功 */
  success?: boolean;
  /** IP 白名单列表 */
  white_list?: string[];
}

export interface DomainVMResource {
  /** @default 1 */
  core?: number;
  /** 过期时间: 倒计时时间，以秒为单位, 0 表示永不过期 */
  life?: number;
  /** @default 1024 */
  memory?: number;
}

export interface DomainVirtualMachine {
  conditions?: GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition[];
  cores?: number;
  created_at?: number;
  environment_id?: string;
  git_identity?: DomainGitIdentity;
  host?: DomainHost;
  hostname?: string;
  id?: string;
  life_time_seconds?: number;
  memory?: number;
  name?: string;
  os?: string;
  owner?: DomainUser;
  ports?: DomainVMPort[];
  repo?: DomainRepositoryItem;
  status?: TypesVirtualMachineStatus;
  version?: string;
}

export interface DomainWallet {
  /** 充值的余额 */
  balance?: number;
  /** 赠送余额 */
  bonus?: number;
  id?: string;
}

export interface GitInChaitinNetAiMonkeycodeMonkeycodeAiDomainIDReqGithubComGoogleUuidUUID {
  id: string;
}

export interface GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesCondition {
  /** Timestamp when condition last changed (Unix ms) */
  last_transition_time?: number;
  /** Human-readable message */
  message?: string;
  /** Progress percentage 0-100 (optional, for long operations) */
  progress?: number;
  /** Machine-readable reason code (CamelCase) */
  reason?: string;
  /** Condition status<br> - 0: unknown 1: in progress 2: completed 3: failed */
  status?: GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionStatus;
  /** Condition<br> - Scheduled: Task has been scheduled<br>- ImagePulled: Base image has been pulled<br>- ProjectCloned: Project repository has been cloned<br> - ImageBuilt: Agent image has been built<br> - ContainerCreated: Container has been created<br>- ContainerStarted: Container has been started<br>- Ready: Environment is ready<br>- Failed: Environment creation failed */
  type?: GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType;
}

/** @format int32 */
export enum GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionStatus {
  ConditionStatusCONDITIONSTATUSUNKNOWN = 0,
  ConditionStatusCONDITIONSTATUSINPROGRESS = 1,
  ConditionStatusCONDITIONSTATUSTRUE = 2,
  ConditionStatusCONDITIONSTATUSFALSE = 3,
}

export enum GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType {
  ConditionTypeScheduled = "Scheduled",
  ConditionTypeImagePulled = "ImagePulled",
  ConditionTypeProjectCloned = "ProjectCloned",
  ConditionTypeImageBuilt = "ImageBuilt",
  ConditionTypeContainerCreated = "ContainerCreated",
  ConditionTypeContainerStarted = "ContainerStarted",
  ConditionTypeReady = "Ready",
  ConditionTypeFailed = "Failed",
}

export interface GocapChallengeData {
  challenge?: GocapChallengeItem;
  /** 过期时间,毫秒级时间戳 */
  expires?: number;
  /** 质询令牌 */
  token?: string;
}

export interface GocapChallengeItem {
  /** 质询数量 */
  c?: number;
  /** 质询难度 */
  d?: number;
  /** 质询大小 */
  s?: number;
}

export interface GocapVerificationResult {
  /** 过期时间,毫秒级时间戳 */
  expires?: number;
  message?: string;
  success?: boolean;
  /** 验证令牌 */
  token?: string;
}

export interface TypesFile {
  accessed_at?: number;
  created_at?: number;
  /** 文件类型 */
  kind?: ConstsFileKind;
  /** 文件名 */
  name?: string;
  /** 文件大小 */
  size?: number;
  /** 链接类型 */
  symlink_kind?: ConstsFileKind;
  /** 链接目标 */
  symlink_target?: string;
  unix_mode?: number;
  updated_at?: number;
  /** 用户名 */
  user?: string;
}

export enum TypesVirtualMachineStatus {
  VirtualMachineStatusUnknown = "unknown",
  VirtualMachineStatusPending = "pending",
  VirtualMachineStatusOnline = "online",
  VirtualMachineStatusOffline = "offline",
}

export interface WebResp {
  code?: number;
  data?: any;
  message?: string;
}
