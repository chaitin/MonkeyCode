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

export enum ConstsGitPlatform {
  GitPlatformGithub = "github",
  GitPlatformGitLab = "gitlab",
  GitPlatformGitea = "gitea",
  GitPlatformGitee = "gitee",
  GitPlatformCodeup = "codeup",
  GitPlatformCnb = "cnb",
  GitPlatformAtomgit = "atomgit",
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

export enum ConstsNotifyChannelKind {
  NotifyChannelDingTalk = "dingtalk",
  NotifyChannelFeishu = "feishu",
  NotifyChannelWeCom = "wecom",
  NotifyChannelWebhook = "webhook",
  NotifyChannelWechatMP = "wechat_mp",
}

export enum ConstsNotifyEventType {
  NotifyEventTaskCreated = "task.created",
  NotifyEventTaskEnded = "task.ended",
  NotifyEventVMExpiringSoon = "vm.expiring_soon",
  NotifyEventQuotaRefreshed = "quota.refreshed",
  NotifyEventQuotaBasicExhausted = "quota.basic_exhausted",
  NotifyEventQuotaProExhausted = "quota.pro_exhausted",
  NotifyEventQuotaUltraExhausted = "quota.ultra_exhausted",
}

export interface ConstsNotifyEventTypeInfo {
  description?: string;
  name?: string;
  type?: ConstsNotifyEventType;
}

export enum ConstsNotifyOwnerType {
  NotifyOwnerUser = "user",
  NotifyOwnerTeam = "team",
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

export enum ConstsSubscriptionPeriodUnit {
  PeriodMonth = "month",
  PeriodYear = "year",
}

export enum ConstsSubscriptionPlan {
  PlanBasic = "basic",
  PlanPro = "pro",
  PlanUltra = "ultra",
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

export enum ConstsTransactionInoutType {
  TransactionInoutTypeIn = "in",
  TransactionInoutTypeOut = "out",
}

export enum ConstsTransactionKind {
  TransactionKindSignupBonus = "signup_bonus",
  TransactionKindVoucherExchange = "voucher_exchange",
  TransactionKindVMConsumption = "vm_consumption",
  TransactionKindModelConsumption = "model_consumption",
  TransactionKindInvitationReward = "invitation_reward",
  TransactionKindProSubscription = "pro_subscription",
  TransactionKindProAutoRenew = "pro_auto_renew",
  TransactionKindUltraSubscription = "ultra_subscription",
  TransactionKindUltraAutoRenew = "ultra_auto_renew",
  TransactionKindProUpgradeRefund = "pro_upgrade_refund",
  TransactionKindDailyGrant = "daily_grant",
  TransactionKindMCPToolConsumption = "mcp_tool_consumption",
  TransactionKindTopUp = "top_up",
  TransactionKindCheckin = "checkin",
  TransactionKindViolationFine = "violation_fine",
  TransactionKindSubscriptionPurchase = "subscription_purchase",
  TransactionKindSubscriptionGrant = "subscription_grant",
  TransactionKindDailyBalanceMigration = "daily_balance_migration",
}

export enum ConstsUserPlatform {
  UserPlatformBaizhi = "baizhi",
  UserPlatformApple = "apple",
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
  UserStatusBanned = "banned",
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
  oauth_site_id?: string;
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
  remark?: string;
  support_image?: boolean;
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

export interface DomainAddTeamUserWithPasswordResp {
  passwords?: DomainTeamUserPassword[];
  users?: DomainTeamUser[];
}

export interface DomainAppleLoginReq {
  authorization_code?: string;
  full_name?: string;
  identity_token: string;
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

export interface DomainAutoRenewReq {
  auto_renew?: boolean;
}

export interface DomainAvailableModelResp {
  access_level?: string;
  id?: string;
  /** 积分/1K input tokens（账面值） */
  input_price?: number;
  is_free?: boolean;
  is_hidden?: boolean;
  name?: string;
  /** 积分/1K output tokens（账面值） */
  output_price?: number;
  support_image?: boolean;
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

export interface DomainCheckInReq {
  captcha_token: string;
}

export interface DomainCheckInResp {
  /** 今天是否已签到 */
  checked_in?: boolean;
}

export interface DomainCheckModelResp {
  error?: string;
  success?: boolean;
}

export interface DomainCollaborator {
  avatar_url?: string;
  email?: string;
  /** 免费 Tokens 耗尽后是否继续启用积分消费模型，未配置时默认 true */
  enable_credit_consumption?: boolean;
  has_password?: boolean;
  id?: string;
  /** 用户绑定的身份列表，例如 github, gitlab */
  identities?: DomainUserIdentity[];
  is_blocked?: boolean;
  name?: string;
  /** 权限 */
  permission?: ConstsProjectCollaboratorRole;
  read_only?: boolean;
  role?: ConstsUserRole;
  status?: ConstsUserStatus;
  team?: DomainTeam;
  token?: string;
  wechat_mp_bound?: boolean;
}

export interface DomainCreateCollaboratorItem {
  /** 权限 */
  permission?: ConstsProjectCollaboratorRole;
  /** 用户ID */
  user_id?: string;
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
  /** @min 1 */
  context_limit?: number;
  interface_type: "openai_chat" | "openai_responses" | "anthropic";
  is_default?: boolean;
  model: string;
  /** @min 1 */
  output_limit?: number;
  provider: string;
  remark?: string;
  support_image?: boolean;
  temperature?: number;
  thinking_enabled?: boolean;
}

export interface DomainCreateNotifyChannelReq {
  /**
   * 订阅的事件类型
   * @minItems 1
   */
  event_types: ConstsNotifyEventType[];
  headers?: Record<string, string>;
  kind: "dingtalk" | "feishu" | "wecom" | "webhook";
  /** @maxLength 64 */
  name: string;
  secret?: string;
  webhook_url: string;
}

export interface DomainCreateProjectReq {
  /** 项目描述 */
  description?: string;
  /** 环境变量 */
  env_variables?: Record<string, any>;
  /** 关联的 git identity id */
  git_identity_id?: string;
  /** 关联的镜像ID */
  image_id?: string;
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
  /** 模型ID economy: 指定用便宜的模型 */
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
  /** 模型ID economy: 指定用便宜的模型 */
  model_id: string;
  /** 宿主机名称 */
  name: string;
  /** 仓库请求 */
  repo?: DomainTaskRepoReq;
  /** 资源配置 */
  resource: DomainResource;
}

export interface DomainCreditConsumptionReq {
  /** 免费 Tokens 耗尽后是否继续启用积分消费模型 */
  enable_credit_consumption?: boolean;
}

export interface DomainDeleteImageReq {
  id: string;
}

export interface DomainExchangeReq {
  /** 兑换码 */
  code?: string;
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
  oauth_site_id?: string;
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

export interface DomainImportLicenseResp {
  /** license 唯一 ID */
  license_id?: string;
  /** 导入后的授权状态 */
  state?: DomainLicenseState;
}

export interface DomainInstallCommand {
  command?: string;
}

export interface DomainInvitationItem {
  avatar_url?: string;
  credits?: number;
  id?: string;
  invited_at?: number;
  name?: string;
}

export interface DomainInvitationListResp {
  count?: number;
  items?: DomainInvitationItem[];
  page?: Dbv2PageInfo;
}

export interface DomainLicenseMachineCodeResp {
  /** 机器码生成时间，RFC3339 */
  generated_at?: string;
  /** 客户部署实例 ID */
  installation_id?: string;
  /** 产品标识，首版固定为 monkeycode-enterprise */
  product?: DomainLicenseProduct;
  /** 当前私有化产品版本 */
  product_version?: string;
  /** 协议版本，首版固定为 1 */
  version?: number;
}

export enum DomainLicenseProduct {
  LicenseProductMonkeyCodeEnterprise = "monkeycode-enterprise",
}

export enum DomainLicenseState {
  LicenseStateMissing = "missing",
  LicenseStateActive = "active",
  LicenseStateExpired = "expired",
  LicenseStateInvalid = "invalid",
}

export interface DomainLicenseStatusResp {
  /** 客户名称 */
  customer_name?: string;
  /** 授权过期时间，RFC3339 */
  expires_at?: string;
  /** 当前生效 license ID */
  license_id?: string;
  /** 授权席位数 */
  seats?: number;
  /** 当前授权状态 */
  state?: DomainLicenseState;
  /** 当前已使用席位数 */
  used_seats?: number;
}

export interface DomainListAuditsResponse {
  audits?: DomainAudit[];
  page?: Dbv2Cursor;
}

export interface DomainListCollaboratorsResp {
  /** 协作者列表 */
  collaborators?: DomainCollaborator[];
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
  /** 分页信息 */
  page_info?: Dbv2PageInfo;
  /** 任务列表 */
  tasks?: DomainProjectTask[];
}

export interface DomainListTeamGroupUsersResp {
  users?: DomainUser[];
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
  /** 访问级别 basic | pro | ultra */
  access_level?: string;
  api_key?: string;
  base_url?: string;
  context_limit?: number;
  created_at?: number;
  id?: string;
  interface_type?: ConstsInterfaceType;
  is_default?: boolean;
  is_free?: boolean;
  is_hidden?: boolean;
  last_check_at?: number;
  last_check_error?: string;
  last_check_success?: boolean;
  model?: string;
  output_limit?: number;
  owner?: DomainOwner;
  provider?: string;
  remark?: string;
  support_image?: boolean;
  temperature?: number;
  thinking_enabled?: boolean;
  updated_at?: number;
  weight?: number;
}

export interface DomainModelBrief {
  access_level?: string;
  context_limit?: number;
  created_at?: number;
  id?: string;
  interface_type?: ConstsInterfaceType;
  is_free?: boolean;
  is_hidden?: boolean;
  last_check_at?: number;
  last_check_error?: string;
  last_check_success?: boolean;
  model?: string;
  output_limit?: number;
  owner?: DomainOwner;
  provider?: string;
  remark?: string;
  support_image?: boolean;
  temperature?: number;
  thinking_enabled?: boolean;
  updated_at?: number;
  weight?: number;
}

export interface DomainNotifyChannel {
  created_at?: number;
  enabled?: boolean;
  event_types?: ConstsNotifyEventType[];
  id?: string;
  kind?: ConstsNotifyChannelKind;
  name?: string;
  owner_id?: string;
  owner_type?: ConstsNotifyOwnerType;
  scope?: string;
  webhook_url?: string;
}

export enum DomainOAuthSiteType {
  OAuthSiteTypeDomestic = "domestic",
  OAuthSiteTypeInternational = "international",
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

export interface DomainPluginListItem {
  active_version?: string;
  description?: string;
  entry?: string;
  id?: string;
  is_force_delivery?: boolean;
  name?: string;
}

export interface DomainPresignReq {
  /** 文件名，服务端会保留扩展名并生成临时文件 object key */
  filename: string;
}

export interface DomainPresignResp {
  /** 文件访问URL */
  access_url?: string;
  /** 预签名上传URL，使用PUT方法上传 */
  upload_url?: string;
}

export interface DomainProject {
  /** 是否开启自动审查 */
  auto_review_enabled?: boolean;
  /** 协作者列表 */
  collaborators?: DomainCollaborator[];
  /** 创建时间 */
  created_at?: number;
  /** 项目描述 */
  description?: string;
  /** 环境变量 */
  env_variables?: Record<string, any>;
  /** 仓库 full_name */
  full_name?: string;
  /** 项目关联的 git identity id */
  git_identity_id?: string;
  /** 项目ID */
  id?: string;
  /** 项目关联的镜像ID */
  image_id?: string;
  /** 问题列表 */
  issues?: DomainProjectIssue[];
  /** 项目名 */
  name?: string;
  /** 项目平台 */
  platform?: ConstsGitPlatform;
  /** 项目仓库URL */
  repo_url?: string;
  /** 项目相关的任务 */
  tasks?: DomainProjectTask[];
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
  full_name?: string;
  id: string;
  identity?: DomainGitIdentity;
  image?: DomainImage;
  model?: DomainModelBrief;
  repo_filename?: string;
  repo_url?: string;
  /** 统计数据 */
  stats?: DomainTaskStats;
  /** 任务状态 */
  status?: ConstsTaskStatus;
  /** 任务子类型 */
  sub_type?: ConstsTaskSubType;
  /** 任务摘要 */
  summary?: string;
  /** 任务标题 */
  title?: string;
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

export interface DomainRechargeReq {
  /** 积分充值套餐: 2000 / 15000 / 100000 / 500000 */
  credits?: number;
  /** 购买周期数量，必须大于 0 */
  period_count?: number;
  /** 购买周期: month | year */
  period_unit?: ConstsSubscriptionPeriodUnit;
  /** 会员版本: pro | ultra */
  plan?: ConstsSubscriptionPlan;
}

export interface DomainRechargeResp {
  /** 支持链接 */
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

export interface DomainSendBindEmailVerificationReq {
  /** 要绑定的邮箱地址 */
  email: string;
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
  site_type?: DomainOAuthSiteType;
}

export interface DomainSitesResp {
  sites?: DomainSiteInfo[];
}

export interface DomainSkillListItem {
  active_version?: string;
  description?: string;
  id?: string;
  is_force_delivery?: boolean;
  name?: string;
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
}

export interface DomainSubscribeReq {
  plan: "pro" | "ultra";
}

export interface DomainSubscriptionResp {
  auto_renew?: boolean;
  /** 免费 Tokens 耗尽后是否继续启用积分消费模型，未配置时默认 true */
  enable_credit_consumption?: boolean;
  expires_at?: string;
  /** "basic" | "pro" | "ultra" */
  plan?: string;
  /** "purchase" | "team_member" | "admin_grant" | "invitation" */
  source?: string;
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
  full_name?: string;
  id?: string;
  identity?: DomainGitIdentity;
  image?: DomainImage;
  model?: DomainModelBrief;
  repo_filename?: string;
  repo_url?: string;
  /** 统计数据 */
  stats?: DomainTaskStats;
  /** 任务状态 */
  status?: ConstsTaskStatus;
  /** 任务子类型 */
  sub_type?: ConstsTaskSubType;
  /** 任务摘要 */
  summary?: string;
  /** 任务标题 */
  title?: string;
  /** 任务类型 */
  type?: ConstsTaskType;
  /** 虚拟机 */
  virtualmachine?: DomainVirtualMachine;
}

export interface DomainTaskExtraConfig {
  issue_id?: string;
  /** Plugin IDs 数组（仅 OpenCode 真正下发） */
  plugin_ids?: string[];
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

export interface DomainTaskStats {
  input_tokens?: number;
  llm_requests?: number;
  output_tokens?: number;
  total_tokens?: number;
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
  is_hidden?: boolean;
  last_check_at?: number;
  last_check_error?: string;
  last_check_success?: boolean;
  model?: string;
  provider?: string;
  remark?: string;
  support_image?: boolean;
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

export interface DomainTeamUserPassword {
  email?: string;
  password?: string;
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
  /** 余额变动 */
  amount_balance?: number;
  /** 当日钱包变动 */
  amount_daily?: number;
  /** 交易时间 */
  created_at?: number;
  /** 收支类型 */
  inout_type?: ConstsTransactionInoutType;
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
  clear_oauth_site_id?: boolean;
  email?: string;
  oauth_site_id?: string;
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
  /** @min 1 */
  context_limit?: number;
  interface_type?: "openai_chat" | "openai_responses" | "anthropic";
  is_default?: boolean;
  model?: string;
  /** @min 1 */
  output_limit?: number;
  provider?: string;
  remark?: string;
  support_image?: boolean;
  temperature?: number;
  thinking_enabled?: boolean;
}

export interface DomainUpdateNotifyChannelReq {
  enabled?: boolean;
  event_types?: ConstsNotifyEventType[];
  headers?: Record<string, string>;
  name?: string;
  secret?: string;
  webhook_url?: string;
}

export interface DomainUpdateProjectReq {
  /** 创建协作者列表 */
  collaborators?: DomainCreateCollaboratorItem[];
  /** 项目描述 */
  description?: string;
  /** 环境变量 */
  env_variables?: Record<string, any>;
  /** 关联的镜像ID */
  image_id?: string;
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
  remark?: string;
  support_image?: boolean;
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
  /** 免费 Tokens 耗尽后是否继续启用积分消费模型，未配置时默认 true */
  enable_credit_consumption?: boolean;
  has_password?: boolean;
  id?: string;
  /** 用户绑定的身份列表，例如 github, gitlab */
  identities?: DomainUserIdentity[];
  is_blocked?: boolean;
  name?: string;
  read_only?: boolean;
  role?: ConstsUserRole;
  status?: ConstsUserStatus;
  team?: DomainTeam;
  token?: string;
  wechat_mp_bound?: boolean;
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
  status?: GithubComChaitinMonkeyCodeBackendPkgTaskflowVirtualMachineStatus;
  version?: string;
}

export interface DomainWallet {
  /** 积分余额 */
  balance?: number;
  /** 基础会员每日模型剩余 tokens */
  daily_basic_token_balance?: number;
  /** 专业会员每日模型剩余 tokens */
  daily_pro_token_balance?: number;
  /** 旗舰会员每日模型剩余 tokens */
  daily_ultra_token_balance?: number;
  id?: string;
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

export interface GitInChaitinNetGoDevWebResp {
  code?: number;
  data?: any;
  message?: string;
}

export interface GithubComGoYokoWebResp {
  code?: number;
  data?: any;
  message?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDbCursor {
  /** 游标 */
  cursor?: string;
  /** 是否有下一页 */
  has_next_page?: boolean;
}

export enum GithubComChaitinMonkeyCodeBackendDbMcptoolScope {
  ScopeUser = "user",
  ScopePlatform = "platform",
  ScopeTeam = "team",
}

export enum GithubComChaitinMonkeyCodeBackendDbMcpupstreamScope {
  ScopeUser = "user",
  ScopePlatform = "platform",
  ScopeTeam = "team",
}

export interface GithubComChaitinMonkeyCodeBackendDomainAddTeamSkillReq {
  /** SKILL.md 原文 */
  content: string;
  description: string;
  group_ids?: string[];
  is_force_delivery?: boolean;
  name: string;
  skill_md_path?: string;
  source_label?: string;
  /**
   * SourceType ∈ {"zip","markdown","text"};SourceLabel 为文件名或 "粘贴文本"。
   * 纯展示元数据,存进 active version 的 parsed_meta。
   */
  source_type?: string;
  tags?: string[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainBindQRCodeResp {
  expire_seconds?: number;
  qrcode_url?: string;
  ticket?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainCreateTeamMCPUpstreamReq {
  description?: string;
  enabled?: boolean;
  group_ids?: string[];
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  name: string;
  slug: string;
  url: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainCreateUserMCPUpstreamReq {
  description?: string;
  enabled?: boolean;
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  name?: string;
  slug?: string;
  url?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainIDReqGithubComGoogleUuidUUID {
  id: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainImportTeamExtensionPackageResp {
  created_images?: number;
  created_rules?: number;
  created_skills?: number;
  package_id?: string;
  updated_images?: number;
  updated_rules?: number;
  updated_skills?: number;
  version?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainListTeamMCPUpstreamsResp {
  items?: GithubComChaitinMonkeyCodeBackendDomainTeamMCPUpstream[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainListTeamSkillsResp {
  skills?: GithubComChaitinMonkeyCodeBackendDomainTeamSkill[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainListUserMCPUpstreamsResp {
  items?: GithubComChaitinMonkeyCodeBackendDomainMCPUpstream[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainMCPHeader {
  name?: string;
  value?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainMCPTool {
  created_at?: number;
  description?: string;
  enabled?: boolean;
  id?: string;
  input_schema?: Record<string, any>;
  name?: string;
  namespaced_name?: string;
  price?: number;
  scope?: GithubComChaitinMonkeyCodeBackendDbMcptoolScope;
}

export interface GithubComChaitinMonkeyCodeBackendDomainMCPUpstream {
  created_at?: number;
  description?: string;
  enabled?: boolean;
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  health_checked_at?: number;
  health_status?: string;
  id?: string;
  last_synced_at?: number;
  name?: string;
  scope?: GithubComChaitinMonkeyCodeBackendDbMcpupstreamScope;
  slug?: string;
  sync_status?: string;
  tools?: GithubComChaitinMonkeyCodeBackendDomainMCPTool[];
  type?: string;
  url?: string;
  user?: DomainUser;
}

export interface GithubComChaitinMonkeyCodeBackendDomainOAuthLoginResp {
  auth_url?: string;
}

export enum GithubComChaitinMonkeyCodeBackendDomainProductEdition {
  ProductEditionSaaS = "saas",
  ProductEditionPrivate = "private",
}

export enum GithubComChaitinMonkeyCodeBackendDomainProductRegion {
  ProductRegionCN = "cn",
  ProductRegionGlobal = "global",
}

export interface GithubComChaitinMonkeyCodeBackendDomainSaveTeamOIDCConfigReq {
  allow_password_login?: boolean;
  auto_create_member?: boolean;
  client_id: string;
  client_secret?: string;
  display_name: string;
  email_domain?: string;
  enabled?: boolean;
  issuer: string;
  scopes?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainServerConfig {
  /**
   * CurrentVersion 当前服务版本。
   * @example "v1.2.3"
   */
  current_version?: string;
  /**
   * Edition 当前产品形态：SaaS 或私有化版本。
   * @example "saas"
   */
  edition?: "saas" | "private";
  /**
   * LatestVersion 最新可用版本。
   * @example "v1.2.4"
   */
  latest_version?: string;
  /**
   * Region SaaS 区域，国内 SaaS 返回 cn，海外 SaaS 返回 global。
   * @example "cn"
   */
  region?: "cn" | "global";
}

export interface GithubComChaitinMonkeyCodeBackendDomainSkillGroupRef {
  id?: string;
  name?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainSpeechStreamError {
  /**
   * 错误码;远端 ASR 错误码 (如豆包 45000001),本地校验错误为 0
   * @example 45000001
   */
  code?: number;
  /**
   * 远端 ASR 服务返回的 trace id (如豆包 X-Tt-Logid),报障必备
   * @example "202407261553070FACFE6D19421815D605"
   */
  logid?: string;
  /**
   * 错误描述,远端错误为远端 message,本地校验错误为可读原因
   * @example "请求参数无效"
   */
  message?: string;
  /**
   * 后端发给远端 ASR 的 X-Api-Request-Id (UUID),便于跟单次请求关联日志
   * @example "67ee89ba-7050-4c04-a3d7-ac61a63499b3"
   */
  request_id?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainSpeechStreamEvent {
  /** 错误详情;仅 error 事件携带 */
  error?: GithubComChaitinMonkeyCodeBackendDomainSpeechStreamError;
  /**
   * 句子序号,从 1 开始;partial / final 携带,其余事件省略
   * @example 1
   */
  index?: number;
  /**
   * 远端 ASR 服务的 trace id;ready / error 事件携带,便于全程关联日志
   * @example "202407261553070FACFE6D19421815D605"
   */
  logid?: string;
  /**
   * 识别文本;partial(中间结果,会反复变化)/ final(本句定稿)携带
   * @example "今天天气真不错。"
   */
  text?: string;
  /**
   * 服务端时间(毫秒),所有事件都有
   * @example 1733299200000
   */
  timestamp?: number;
  /**
   * 事件类型:ready / partial / final / done / error
   * @example "partial"
   */
  type?: "ready" | "partial" | "final" | "done" | "error";
}

export interface GithubComChaitinMonkeyCodeBackendDomainSpeechStreamStartReq {
  /**
   * 是否启用语义顺滑(过滤"嗯/啊"等口头禅、语义重复词),默认 false
   * @example false
   */
  disfluency?: boolean;
  /**
   * 音频容器格式,单声道、16-bit、采样率固定 16000Hz。
   * pcm / wav 内部音频流必须是 pcm_s16le;ogg 必须为 opus 编码;mp3 由服务端解码。
   * @example "pcm"
   */
  format?: "pcm" | "wav" | "ogg" | "mp3";
  /**
   * 消息类型,固定为 "start"
   * @example "start"
   */
  type: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTaskChunkEntry {
  data?: number[];
  event?: string;
  kind?: string;
  labels?: Record<string, string>;
  /** 轮次号，可作为 cursor 翻页；仅日志存储为 ClickHouse 时有值 */
  seq?: number;
  timestamp?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTaskRoundsResp {
  chunks?: GithubComChaitinMonkeyCodeBackendDomainTaskChunkEntry[];
  has_more?: boolean;
  /** 下一页游标 */
  next_cursor?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTaskUserInputItem {
  /** 用户输入文本，超过 500 字符截断 */
  content?: string;
  /** 与前端 message.id 对齐：user-input-{timestamp} */
  id?: string;
  /** 轮次号，可作为 /rounds 的 cursor 跳转定位；仅日志存储为 ClickHouse 时有值 */
  seq?: number;
  /** 纳秒，与 chunk.timestamp 对齐 */
  timestamp?: number;
  /** 是否被截断 */
  truncated?: boolean;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTaskUserInputsResp {
  has_more?: boolean;
  items?: GithubComChaitinMonkeyCodeBackendDomainTaskUserInputItem[];
  next_cursor?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamConversationItem {
  attachment_count?: number;
  content?: string;
  created_at?: number;
  creator?: DomainUser;
  id?: string;
  project_id?: string;
  project_name?: string;
  task_id?: string;
  task_title?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamConversationListResp {
  conversations?: GithubComChaitinMonkeyCodeBackendDomainTeamConversationItem[];
  page?: GithubComChaitinMonkeyCodeBackendDbCursor;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamConversationStats {
  count_7d?: number;
  count_today?: number;
  daily_created?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
  total?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardConsumptionInsight {
  id?: string;
  llm_requests?: number;
  name?: string;
  percent?: number;
  total_tokens?: number;
  type?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardInsights {
  active_members?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardMemberInsight[];
  high_consumption?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardConsumptionInsight[];
  long_running_tasks?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTaskInsight[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardMemberInsight {
  email?: string;
  group_name?: string;
  last_active_at?: number;
  name?: string;
  task_count?: number;
  user_id?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardMetrics {
  active_members?: number;
  active_rate?: number;
  average_duration?: number;
  cache_hit_rate?: number;
  cached_tokens?: number;
  finished_task_count?: number;
  input_tokens?: number;
  llm_requests?: number;
  output_tokens?: number;
  running_task_count?: number;
  task_count?: number;
  total_members?: number;
  total_tokens?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardResp {
  conversation_stats?: GithubComChaitinMonkeyCodeBackendDomainTeamConversationStats;
  end_at?: number;
  insights?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardInsights;
  metrics?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardMetrics;
  project_stats?: GithubComChaitinMonkeyCodeBackendDomainTeamProjectStats;
  range?: string;
  start_at?: number;
  task_stats?: GithubComChaitinMonkeyCodeBackendDomainTeamTaskStats;
  trends?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrends;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTaskInsight {
  created_at?: number;
  creator?: string;
  duration?: number;
  host_name?: string;
  status?: string;
  task_id?: string;
  title?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint {
  date?: string;
  value?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrends {
  active_members?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
  task_counts?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
  token_usage?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamMCPUpstream {
  created_at?: number;
  description?: string;
  enabled?: boolean;
  groups?: GithubComChaitinMonkeyCodeBackendDomainSkillGroupRef[];
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  health_checked_at?: number;
  health_status?: string;
  id?: string;
  last_synced_at?: number;
  name?: string;
  scope?: GithubComChaitinMonkeyCodeBackendDbMcpupstreamScope;
  slug?: string;
  sync_status?: string;
  team_id?: string;
  tools?: GithubComChaitinMonkeyCodeBackendDomainMCPTool[];
  type?: string;
  url?: string;
  user?: DomainUser;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamOIDCConfig {
  allow_password_login?: boolean;
  auto_create_member?: boolean;
  client_id?: string;
  display_name?: string;
  email_domain?: string;
  enabled?: boolean;
  has_client_secret?: boolean;
  id?: string;
  issuer?: string;
  login_url?: string;
  redirect_uri?: string;
  scopes?: string;
  team_id?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamOIDCConfigResp {
  config?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCConfig;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamOIDCPublicConfigResp {
  display_name?: string;
  enabled?: boolean;
  login_url?: string;
  team_id?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamOIDCTestResp {
  issuer?: string;
  message?: string;
  success?: boolean;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamProjectItem {
  branch?: string;
  created_at?: number;
  creator?: DomainUser;
  id?: string;
  issue_count?: number;
  name?: string;
  repo_url?: string;
  task_count?: number;
  updated_at?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamProjectListResp {
  page?: GithubComChaitinMonkeyCodeBackendDbCursor;
  projects?: GithubComChaitinMonkeyCodeBackendDomainTeamProjectItem[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamProjectStats {
  active_7d?: number;
  active_today?: number;
  daily_created?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
  total?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamSkill {
  active_version?: string;
  categories?: string[];
  /** SKILL.md 文本,从 active version 当时入库时记录 */
  content?: string;
  created_at?: number;
  description?: string;
  enabled?: boolean;
  groups?: GithubComChaitinMonkeyCodeBackendDomainSkillGroupRef[];
  id?: string;
  is_force_delivery?: boolean;
  name?: string;
  s3_key?: string;
  skill_md_path?: string;
  source_label?: string;
  source_type?: string;
  tags?: string[];
  updated_at?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamTaskItem {
  content?: string;
  created_at?: number;
  creator?: DomainUser;
  id?: string;
  kind?: string;
  last_active_at?: number;
  project_id?: string;
  project_name?: string;
  status?: string;
  title?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamTaskListResp {
  page?: GithubComChaitinMonkeyCodeBackendDbCursor;
  tasks?: GithubComChaitinMonkeyCodeBackendDomainTeamTaskItem[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamTaskStats {
  active_7d?: number;
  active_today?: number;
  daily_created?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardTrendPoint[];
  total?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainTeamTaskVMIdlePolicy {
  effective_recycle_seconds?: number;
  effective_sleep_seconds?: number;
  recycle_enabled?: boolean;
  recycle_inherited?: boolean;
  recycle_seconds?: number;
  sleep_enabled?: boolean;
  sleep_inherited?: boolean;
  sleep_seconds?: number;
  task_concurrency_limit?: number;
  team_id?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateTaskReq {
  title?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateTeamMCPUpstreamReq {
  description?: string;
  enabled?: boolean;
  group_ids?: string[];
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  name?: string;
  slug?: string;
  url?: string;
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateTeamSkillReq {
  content?: string;
  description?: string;
  group_ids?: string[];
  is_force_delivery?: boolean;
  /** 当前不允许改 name(unique 索引硬约束),保留位 */
  name?: string;
  skill_md_path?: string;
  source_label?: string;
  source_type?: string;
  tags?: string[];
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateTeamTaskVMIdlePolicyReq {
  recycle_enabled?: boolean;
  recycle_seconds?: number;
  sleep_enabled?: boolean;
  sleep_seconds?: number;
  task_concurrency_limit?: number;
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateUserMCPToolSettingReq {
  enabled?: boolean;
}

export interface GithubComChaitinMonkeyCodeBackendDomainUpdateUserMCPUpstreamReq {
  description?: string;
  enabled?: boolean;
  headers?: GithubComChaitinMonkeyCodeBackendDomainMCPHeader[];
  name?: string;
  slug?: string;
  url?: string;
}

export interface GithubComChaitinMonkeyCodeBackendPkgTaskflowFile {
  accessed_at?: number;
  created_at?: number;
  kind?: GithubComChaitinMonkeyCodeBackendPkgTaskflowFileKind;
  name?: string;
  size?: number;
  symlink_kind?: GithubComChaitinMonkeyCodeBackendPkgTaskflowFileKind;
  symlink_target?: string;
  unix_mode?: number;
  updated_at?: number;
  user?: string;
}

export enum GithubComChaitinMonkeyCodeBackendPkgTaskflowFileKind {
  FileKindUnknown = "unknown",
  FileKindFile = "file",
  FileKindDir = "dir",
  FileKindSymlink = "symlink",
}

export enum GithubComChaitinMonkeyCodeBackendPkgTaskflowVirtualMachineStatus {
  VirtualMachineStatusUnknown = "unknown",
  VirtualMachineStatusPending = "pending",
  VirtualMachineStatusOnline = "online",
  VirtualMachineStatusOffline = "offline",
  VirtualMachineStatusHibernated = "hibernated",
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

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<FullRequestParams, "body" | "method" | "query" | "path">;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (securityData: SecurityDataType | null) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown> extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) => fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter((key) => "undefined" !== typeof query[key]);
    return keys
      .map((key) => (Array.isArray(query[key]) ? this.addArrayQueryParam(query, key) : this.addQueryParam(query, key)))
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string") ? JSON.stringify(input) : input,
    [ContentType.Text]: (input: any) => (input !== null && typeof input !== "string" ? JSON.stringify(input) : input),
    [ContentType.FormData]: (input: any) =>
      Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
            ? JSON.stringify(property)
            : `${property}`,
        );
        return formData;
      }, new FormData()),
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(params1: RequestParams, params2?: RequestParams): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (cancelToken: CancelToken): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(`${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`, {
      ...requestParams,
      headers: {
        ...(requestParams.headers || {}),
        ...(type && type !== ContentType.FormData ? { "Content-Type": type } : {}),
      },
      signal: cancelToken ? this.createAbortSignal(cancelToken) : requestParams.signal,
      body: typeof body === "undefined" || body === null ? null : payloadFormatter(body),
    }).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const data = !responseFormat
        ? r
        : await response[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title MonkeyCode AI
 * @version 1.0
 * @contact
 *
 * MonkeyCode AI
 */
export class Api<SecurityDataType extends unknown> extends HttpClient<SecurityDataType> {
  api = {
    /**
     * @description 通过管理后台生成的一次性 token，以只读方式登录指定用户账号
     *
     * @tags 【用户】认证
     * @name V1AuthImpersonateList
     * @summary 管理员模拟登录
     * @request GET:/api/v1/auth/impersonate
     */
    v1AuthImpersonateList: (
      query: {
        /** 一次性模拟登录 token */
        token: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/auth/impersonate`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 获取 CNB (cnb.cool) OAuth 授权 URL
     *
     * @tags 【用户】git 身份管理
     * @name V1CnbAuthorizeUrlList
     * @summary CNB OAuth 授权
     * @request GET:/api/v1/cnb/authorize_url
     * @secure
     */
    v1CnbAuthorizeUrlList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainOAuthURLResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/cnb/authorize_url`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取 Gitea OAuth 授权 URL
     *
     * @tags 【用户】git 身份管理
     * @name V1GiteaAuthorizeUrlList
     * @summary Gitea OAuth 授权
     * @request GET:/api/v1/gitea/authorize_url
     * @secure
     */
    v1GiteaAuthorizeUrlList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainOAuthURLResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/gitea/authorize_url`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 返回当前用户所有团队合并后的 Gitea 站点列表（团队配置优先，全局配置兜底），不含凭证信息
     *
     * @tags 站点管理
     * @name V1GiteaSitesList
     * @summary 获取 Gitea 可用站点列表
     * @request GET:/api/v1/gitea/sites
     * @secure
     */
    v1GiteaSitesList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainSitesResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/gitea/sites`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取 Gitee OAuth 授权 URL
     *
     * @tags 【用户】git 身份管理
     * @name V1GiteeAuthorizeUrlList
     * @summary Gitee OAuth 授权
     * @request GET:/api/v1/gitee/authorize_url
     * @secure
     */
    v1GiteeAuthorizeUrlList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainOAuthURLResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/gitee/authorize_url`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取 GitLab OAuth 授权 URL
     *
     * @tags 【用户】git 身份管理
     * @name V1GitlabAuthorizeUrlList
     * @summary GitLab OAuth 授权
     * @request GET:/api/v1/gitlab/authorize_url
     * @secure
     */
    v1GitlabAuthorizeUrlList: (
      query: {
        /** GitLab 实例 Base URL */
        base: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainOAuthURLResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/gitlab/authorize_url`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 返回当前用户所有团队合并后的 GitLab 站点列表（团队配置优先，全局配置兜底），不含凭证信息
     *
     * @tags 站点管理
     * @name V1GitlabSitesList
     * @summary 获取 GitLab 可用站点列表
     * @request GET:/api/v1/gitlab/sites
     * @secure
     */
    v1GitlabSitesList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainSitesResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/gitlab/sites`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 私有化部署直接上传 license.lic 文件。SaaS 环境仅用于生成 Swagger 文档，实际业务由 MonkeyCodePro 实现。
     *
     * @tags 【License】License
     * @name V1LicenseImportCreate
     * @summary 导入 license
     * @request POST:/api/v1/license/import
     * @secure
     */
    v1LicenseImportCreate: (
      data: {
        /**
         * license.lic 文件
         * @format binary
         */
        file: File;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainImportLicenseResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/license/import`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 私有化部署导出 machine-code.json。SaaS 环境仅用于生成 Swagger 文档，实际业务由 MonkeyCodePro 实现。
     *
     * @tags 【License】License
     * @name V1LicenseMachineCodeList
     * @summary 导出机器码
     * @request GET:/api/v1/license/machine-code
     * @secure
     */
    v1LicenseMachineCodeList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainLicenseMachineCodeResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/license/machine-code`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 私有化部署查看当前 license 状态。SaaS 环境仅用于生成 Swagger 文档，实际业务由 MonkeyCodePro 实现。
     *
     * @tags 【License】License
     * @name V1LicenseStatusList
     * @summary 查看 license 状态
     * @request GET:/api/v1/license/status
     * @secure
     */
    v1LicenseStatusList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainLicenseStatusResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/license/status`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 绑定第三方平台
     *
     * @tags 【用户】OAuth
     * @name OauthBindUsers
     * @summary 绑定第三方平台
     * @request GET:/api/v1/oauth/bind
     * @secure
     */
    oauthBindUsers: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainOAuthURLResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/oauth/bind`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前登录用户绑定的百知云平台用户信息，包括百知云账号和对应的MonkeyCode账号详情
     *
     * @tags 【用户】OAuth
     * @name OauthGetBoundUsers
     * @summary 获取绑定的平台用户信息
     * @request GET:/api/v1/oauth/bind-users
     * @secure
     */
    oauthGetBoundUsers: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainUser;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/oauth/bind-users`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description 处理 CNB OAuth 回调
     *
     * @tags 【用户】git 身份管理
     * @name V1OauthCnbCallbackList
     * @summary CNB OAuth 回调
     * @request GET:/api/v1/oauth/cnb/callback
     */
    v1OauthCnbCallbackList: (
      query: {
        /** 授权码 */
        code: string;
        /** 状态码 */
        state: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/oauth/cnb/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 处理 Gitea OAuth 回调
     *
     * @tags 【用户】git 身份管理
     * @name V1OauthGiteaCallbackList
     * @summary Gitea OAuth 回调
     * @request GET:/api/v1/oauth/gitea/callback
     */
    v1OauthGiteaCallbackList: (
      query: {
        /** 授权码 */
        code: string;
        /** 状态码 */
        state: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/oauth/gitea/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 处理 Gitee OAuth 回调
     *
     * @tags 【用户】git 身份管理
     * @name V1OauthGiteeCallbackList
     * @summary Gitee OAuth 回调
     * @request GET:/api/v1/oauth/gitee/callback
     */
    v1OauthGiteeCallbackList: (
      query: {
        /** 授权码 */
        code: string;
        /** 状态码 */
        state: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/oauth/gitee/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 处理 GitLab OAuth 回调
     *
     * @tags 【用户】git 身份管理
     * @name V1OauthGitlabCallbackList
     * @summary GitLab OAuth 回调
     * @request GET:/api/v1/oauth/gitlab/callback
     */
    v1OauthGitlabCallbackList: (
      query: {
        /** 授权码 */
        code: string;
        /** 状态码 */
        state: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/oauth/gitlab/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 解除当前登录用户与第三方平台（GitHub/GitLab/Gitee/Gitea）账号的绑定关系
     *
     * @tags 【用户】OAuth
     * @name OauthUnbind
     * @summary 解绑第三方平台账号
     * @request DELETE:/api/v1/oauth/unbind
     * @secure
     */
    oauthUnbind: (
      query: {
        /** 第三方平台 */
        platform: "github" | "gitlab" | "gitee" | "gitea";
      },
      params: RequestParams = {},
    ) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/oauth/unbind`,
        method: "DELETE",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取广场帖子列表，支持游标分页
     *
     * @tags 【公开】广场
     * @name V1PlaygroundPostsList
     * @summary 获取广场帖子列表
     * @request GET:/api/v1/playground-posts
     */
    v1PlaygroundPostsList: (
      query?: {
        /** 内容 */
        content?: string;
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        kind?: "task" | "project" | "normal";
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainListPlaygroundPostResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/playground-posts`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取广场帖子详情
     *
     * @tags 【公开】广场
     * @name V1PlaygroundPostsDetail
     * @summary 获取广场帖子详情
     * @request GET:/api/v1/playground-posts/{id}
     */
    v1PlaygroundPostsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainPlaygroundPost;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/playground-posts/${id}`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 并集返回 (global ∪ 用户 active team) 两级 scope 下的 plugin,同名 team>global 覆盖;disabled 仍返回但 enabled=false。
     *
     * @tags 【公共】plugin
     * @name V1PluginsList
     * @summary 获取 Plugins 列表
     * @request GET:/api/v1/plugins
     * @secure
     */
    v1PluginsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainPluginListItem[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/plugins`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description CreateCaptcha
     *
     * @tags 【验证码】
     * @name V1PublicCaptchaChallengeCreate
     * @summary CreateCaptcha
     * @request POST:/api/v1/public/captcha/challenge
     */
    v1PublicCaptchaChallengeCreate: (params: RequestParams = {}) =>
      this.request<GocapChallengeData, any>({
        path: `/api/v1/public/captcha/challenge`,
        method: "POST",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description RedeemCaptcha
     *
     * @tags 【验证码】
     * @name V1PublicCaptchaRedeemCreate
     * @summary RedeemCaptcha
     * @request POST:/api/v1/public/captcha/redeem
     */
    v1PublicCaptchaRedeemCreate: (body: DomainRedeemCaptchaReq, params: RequestParams = {}) =>
      this.request<GocapVerificationResult, any>({
        path: `/api/v1/public/captcha/redeem`,
        method: "POST",
        body: body,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取数据总览
     *
     * @tags 【公共】欢迎页
     * @name V1PublicStatsList
     * @summary 获取数据总览
     * @request GET:/api/v1/public/stats
     */
    v1PublicStatsList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainStats;
        },
        any
      >({
        path: `/api/v1/public/stats`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 返回当前服务的产品形态、SaaS 区域和版本信息，用于前端区分部署形态和升级状态。
     *
     * @tags 【服务】配置信息
     * @name V1ServerConfigList
     * @summary 获取服务配置
     * @request GET:/api/v1/server/config
     */
    v1ServerConfigList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainServerConfig;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/server/config`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 并集返回 (global ∪ 用户 active team ∪ 用户个人) 三级 scope 下的 skill，禁用的 skill 返回 enabled=false。
     *
     * @tags 【用户】任务管理
     * @name V1SkillsList
     * @summary 获取本用户的 Skill 列表
     * @request GET:/api/v1/skills
     * @secure
     */
    v1SkillsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainSkillListItem[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/skills`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建团队管理员，将用户添加到团队并设置为管理员角色
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsAdminCreate
     * @summary 创建团队管理员
     * @request POST:/api/v1/teams/admin
     * @secure
     */
    v1TeamsAdminCreate: (req: DomainAddTeamAdminReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainAddTeamAdminResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/admin`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 查询审计日志列表，支持条件过滤和分页
     *
     * @tags 【Team管理员】审计日志
     * @name V1TeamsAuditsList
     * @summary 查询审计日志
     * @request GET:/api/v1/teams/audits
     * @secure
     */
    v1TeamsAuditsList: (
      query?: {
        created_at_end?: string;
        created_at_start?: string;
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
        operation?: string;
        request?: string;
        response?: string;
        source_ip?: string;
        user_agent?: string;
        user_id?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<DomainListAuditsResponse, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/audits`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前团队任务日志中的 user-input 对话列表
     *
     * @tags 【Team 管理员】团队对话
     * @name V1TeamsConversationsList
     * @summary 获取团队对话列表
     * @request GET:/api/v1/teams/conversations
     * @secure
     */
    v1TeamsConversationsList: (
      query?: {
        /** 分页游标 */
        cursor?: string;
        /** 每页数量 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamConversationListResp;
        },
        any
      >({
        path: `/api/v1/teams/conversations`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队活跃、任务、耗时、Token 消耗趋势和洞察列表
     *
     * @tags 【Team 管理员】团队概览
     * @name V1TeamsDashboardList
     * @summary 获取团队管理概览
     * @request GET:/api/v1/teams/dashboard
     * @secure
     */
    v1TeamsDashboardList: (
      query?: {
        /** 时间范围：today、7d、30d */
        range?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamDashboardResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/dashboard`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 上传团队扩展包并导入 Skills 和团队镜像记录
     *
     * @tags 【Team 管理员】扩展包管理
     * @name V1TeamsExtensionPackagesCreate
     * @summary 上传团队扩展包
     * @request POST:/api/v1/teams/extension-packages
     * @secure
     */
    v1TeamsExtensionPackagesCreate: (
      data: {
        /**
         * 扩展包 zip
         * @format binary
         */
        file: File;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainImportTeamExtensionPackageResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/extension-packages`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队分组列表
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsList
     * @summary 获取团队分组列表
     * @request GET:/api/v1/teams/groups
     * @secure
     */
    v1TeamsGroupsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTeamGroupsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/groups`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建团队分组
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsCreate
     * @summary 创建团队分组
     * @request POST:/api/v1/teams/groups
     * @secure
     */
    v1TeamsGroupsCreate: (req: DomainAddTeamGroupReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamGroup;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/groups`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队分组
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsUpdate
     * @summary 更新团队分组
     * @request PUT:/api/v1/teams/groups/{group_id}
     * @secure
     */
    v1TeamsGroupsUpdate: (groupId: string, req: DomainUpdateTeamGroupReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamGroup;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/groups/${groupId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队分组
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsDelete
     * @summary 删除团队分组
     * @request DELETE:/api/v1/teams/groups/{group_id}
     * @secure
     */
    v1TeamsGroupsDelete: (groupId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/groups/${groupId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队组成员列表
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsUsersDetail
     * @summary 获取团队组成员列表
     * @request GET:/api/v1/teams/groups/{group_id}/users
     * @secure
     */
    v1TeamsGroupsUsersDetail: (groupId: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTeamGroupUsersResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/groups/${groupId}/users`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 修改团队组成员
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsGroupsUsersUpdate
     * @summary 修改团队组成员
     * @request PUT:/api/v1/teams/groups/{group_id}/users
     * @secure
     */
    v1TeamsGroupsUsersUpdate: (groupId: string, req: DomainAddTeamGroupUsersReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainAddTeamGroupUsersResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/groups/${groupId}/users`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队宿主机列表
     *
     * @tags 【Team 管理员】宿主机管理
     * @name V1TeamsHostsList
     * @summary 获取团队宿主机列表
     * @request GET:/api/v1/teams/hosts
     * @secure
     */
    v1TeamsHostsList: (
      query?: {
        /** 下一页标识 */
        next_token?: string;
        /** 分页 */
        page?: number;
        /** 每页多少条记录 */
        size?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTeamHostsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/hosts`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取宿主机安装命令
     *
     * @tags 【Team 管理员】宿主机管理
     * @name V1TeamsHostsInstallCommandList
     * @summary 获取宿主机安装命令
     * @request GET:/api/v1/teams/hosts/install-command
     * @secure
     */
    v1TeamsHostsInstallCommandList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainInstallCommand;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/hosts/install-command`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队宿主机
     *
     * @tags 【Team 管理员】宿主机管理
     * @name V1TeamsHostsUpdate
     * @summary 更新团队宿主机
     * @request PUT:/api/v1/teams/hosts/{host_id}
     * @secure
     */
    v1TeamsHostsUpdate: (hostId: string, param: DomainUpdateTeamHostReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/hosts/${hostId}`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队宿主机
     *
     * @tags 【Team 管理员】宿主机管理
     * @name V1TeamsHostsDelete
     * @summary 删除团队宿主机
     * @request DELETE:/api/v1/teams/hosts/{host_id}
     * @secure
     */
    v1TeamsHostsDelete: (hostId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/hosts/${hostId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队镜像列表
     *
     * @tags 【Team 管理员】镜像管理
     * @name V1TeamsImagesList
     * @summary 获取团队镜像列表
     * @request GET:/api/v1/teams/images
     * @secure
     */
    v1TeamsImagesList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTeamImagesResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/images`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 添加团队镜像
     *
     * @tags 【Team 管理员】镜像管理
     * @name V1TeamsImagesCreate
     * @summary 添加团队镜像
     * @request POST:/api/v1/teams/images
     * @secure
     */
    v1TeamsImagesCreate: (req: DomainAddTeamImageReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamImage;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/images`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队镜像
     *
     * @tags 【Team 管理员】镜像管理
     * @name V1TeamsImagesUpdate
     * @summary 更新团队镜像
     * @request PUT:/api/v1/teams/images/{image_id}
     * @secure
     */
    v1TeamsImagesUpdate: (imageId: string, req: DomainUpdateTeamImageReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamImage;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/images/${imageId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队镜像
     *
     * @tags 【Team 管理员】镜像管理
     * @name V1TeamsImagesDelete
     * @summary 删除团队镜像
     * @request DELETE:/api/v1/teams/images/{image_id}
     * @secure
     */
    v1TeamsImagesDelete: (imageId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/images/${imageId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】MCP 配置
     * @name V1TeamsMcpUpstreamsList
     * @summary 获取团队 MCP Upstream 列表
     * @request GET:/api/v1/teams/mcp/upstreams
     * @secure
     */
    v1TeamsMcpUpstreamsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainListTeamMCPUpstreamsResp;
        },
        any
      >({
        path: `/api/v1/teams/mcp/upstreams`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】MCP 配置
     * @name V1TeamsMcpUpstreamsCreate
     * @summary 创建团队 MCP Upstream
     * @request POST:/api/v1/teams/mcp/upstreams
     * @secure
     */
    v1TeamsMcpUpstreamsCreate: (
      req: GithubComChaitinMonkeyCodeBackendDomainCreateTeamMCPUpstreamReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamMCPUpstream;
        },
        any
      >({
        path: `/api/v1/teams/mcp/upstreams`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】MCP 配置
     * @name V1TeamsMcpUpstreamsUpdate
     * @summary 更新团队 MCP Upstream
     * @request PUT:/api/v1/teams/mcp/upstreams/{upstream_id}
     * @secure
     */
    v1TeamsMcpUpstreamsUpdate: (
      upstreamId: string,
      req: GithubComChaitinMonkeyCodeBackendDomainUpdateTeamMCPUpstreamReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamMCPUpstream;
        },
        any
      >({
        path: `/api/v1/teams/mcp/upstreams/${upstreamId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】MCP 配置
     * @name V1TeamsMcpUpstreamsDelete
     * @summary 删除团队 MCP Upstream
     * @request DELETE:/api/v1/teams/mcp/upstreams/{upstream_id}
     * @secure
     */
    v1TeamsMcpUpstreamsDelete: (upstreamId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/teams/mcp/upstreams/${upstreamId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】MCP 配置
     * @name V1TeamsMcpUpstreamsSyncCreate
     * @summary 同步团队 MCP Upstream
     * @request POST:/api/v1/teams/mcp/upstreams/{upstream_id}/sync
     * @secure
     */
    v1TeamsMcpUpstreamsSyncCreate: (upstreamId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/teams/mcp/upstreams/${upstreamId}/sync`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队模型配置列表
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsList
     * @summary 获取团队模型配置列表
     * @request GET:/api/v1/teams/models
     * @secure
     */
    v1TeamsModelsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTeamModelsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/models`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 添加团队模型配置
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsCreate
     * @summary 添加团队模型配置
     * @request POST:/api/v1/teams/models
     * @secure
     */
    v1TeamsModelsCreate: (req: DomainAddTeamModelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamModel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/models`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 使用提供的配置进行健康检查，不更新数据库
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsHealthCheckCreate
     * @summary 检查团队模型健康状态（通过配置）
     * @request POST:/api/v1/teams/models/health-check
     * @secure
     */
    v1TeamsModelsHealthCheckCreate: (req: DomainCheckByConfigReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainCheckModelResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/models/health-check`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 对指定团队模型进行健康检查，并更新检查结果到数据库
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsHealthCheckDetail
     * @summary 检查团队模型健康状态（通过ID）
     * @request GET:/api/v1/teams/models/{id}/health-check
     * @secure
     */
    v1TeamsModelsHealthCheckDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainCheckModelResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/models/${id}/health-check`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队模型配置
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsUpdate
     * @summary 更新团队模型配置
     * @request PUT:/api/v1/teams/models/{model_id}
     * @secure
     */
    v1TeamsModelsUpdate: (modelId: string, req: DomainUpdateTeamModelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamModel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/models/${modelId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队模型配置
     *
     * @tags 【Team 管理员】模型管理
     * @name V1TeamsModelsDelete
     * @summary 删除团队模型配置
     * @request DELETE:/api/v1/teams/models/{model_id}
     * @secure
     */
    v1TeamsModelsDelete: (modelId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/models/${modelId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 列出当前团队的所有推送渠道及其订阅配置
     *
     * @tags 【Team 管理员】通知推送
     * @name V1TeamsNotifyChannelsList
     * @summary 列出团队推送渠道
     * @request GET:/api/v1/teams/notify/channels
     * @secure
     */
    v1TeamsNotifyChannelsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/notify/channels`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建团队推送渠道（钉钉/飞书/企业微信/Webhook），同时配置订阅的事件类型
     *
     * @tags 【Team 管理员】通知推送
     * @name V1TeamsNotifyChannelsCreate
     * @summary 创建团队推送渠道
     * @request POST:/api/v1/teams/notify/channels
     * @secure
     */
    v1TeamsNotifyChannelsCreate: (param: DomainCreateNotifyChannelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/notify/channels`,
        method: "POST",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队推送渠道配置及订阅的事件类型
     *
     * @tags 【Team 管理员】通知推送
     * @name V1TeamsNotifyChannelsUpdate
     * @summary 更新团队推送渠道
     * @request PUT:/api/v1/teams/notify/channels/{id}
     * @secure
     */
    v1TeamsNotifyChannelsUpdate: (id: string, param: DomainUpdateNotifyChannelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/notify/channels/${id}`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队推送渠道及其关联的订阅
     *
     * @tags 【Team 管理员】通知推送
     * @name V1TeamsNotifyChannelsDelete
     * @summary 删除团队推送渠道
     * @request DELETE:/api/v1/teams/notify/channels/{id}
     * @secure
     */
    v1TeamsNotifyChannelsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/notify/channels/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 发送测试消息验证渠道配置是否正确
     *
     * @tags 【Team 管理员】通知推送
     * @name V1TeamsNotifyChannelsTestCreate
     * @summary 测试团队推送渠道
     * @request POST:/api/v1/teams/notify/channels/{id}/test
     * @secure
     */
    v1TeamsNotifyChannelsTestCreate: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/notify/channels/${id}/test`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 列出所有支持订阅的事件类型
     *
     * @tags 通知推送
     * @name V1TeamsNotifyEventTypesList
     * @summary 列出事件类型
     * @request GET:/api/v1/teams/notify/event-types
     * @secure
     */
    v1TeamsNotifyEventTypesList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: ConstsNotifyEventTypeInfo[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/notify/event-types`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队 OAuth 站点列表
     *
     * @tags 【Team 管理员】OAuth 站点管理
     * @name V1TeamsOauthSitesList
     * @summary 获取团队 OAuth 站点列表
     * @request GET:/api/v1/teams/oauth-sites
     * @secure
     */
    v1TeamsOauthSitesList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainListTeamOAuthSitesResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/teams/oauth-sites`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 添加团队 OAuth 站点
     *
     * @tags 【Team 管理员】OAuth 站点管理
     * @name V1TeamsOauthSitesCreate
     * @summary 添加团队 OAuth 站点
     * @request POST:/api/v1/teams/oauth-sites
     * @secure
     */
    v1TeamsOauthSitesCreate: (req: DomainAddTeamOAuthSiteReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainTeamOAuthSite;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/teams/oauth-sites`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队 OAuth 站点
     *
     * @tags 【Team 管理员】OAuth 站点管理
     * @name V1TeamsOauthSitesUpdate
     * @summary 更新团队 OAuth 站点
     * @request PUT:/api/v1/teams/oauth-sites/{site_id}
     * @secure
     */
    v1TeamsOauthSitesUpdate: (siteId: string, req: DomainUpdateTeamOAuthSiteReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainTeamOAuthSite;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/teams/oauth-sites/${siteId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除团队 OAuth 站点
     *
     * @tags 【Team 管理员】OAuth 站点管理
     * @name V1TeamsOauthSitesDelete
     * @summary 删除团队 OAuth 站点
     * @request DELETE:/api/v1/teams/oauth-sites/{site_id}
     * @secure
     */
    v1TeamsOauthSitesDelete: (siteId: string, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/teams/oauth-sites/${siteId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前团队企业登录 OIDC 配置
     *
     * @tags 【Team 管理员】企业登录
     * @name V1TeamsOidcList
     * @summary 获取团队 OIDC 配置
     * @request GET:/api/v1/teams/oidc
     * @secure
     */
    v1TeamsOidcList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCConfigResp;
        },
        any
      >({
        path: `/api/v1/teams/oidc`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 新增或更新当前团队企业登录 OIDC 配置
     *
     * @tags 【Team 管理员】企业登录
     * @name V1TeamsOidcUpdate
     * @summary 保存团队 OIDC 配置
     * @request PUT:/api/v1/teams/oidc
     * @secure
     */
    v1TeamsOidcUpdate: (
      req: GithubComChaitinMonkeyCodeBackendDomainSaveTeamOIDCConfigReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCConfigResp;
        },
        any
      >({
        path: `/api/v1/teams/oidc`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 拉取 OIDC discovery 文档验证配置可用性
     *
     * @tags 【Team 管理员】企业登录
     * @name V1TeamsOidcTestCreate
     * @summary 测试团队 OIDC 配置
     * @request POST:/api/v1/teams/oidc/test
     * @secure
     */
    v1TeamsOidcTestCreate: (
      req: GithubComChaitinMonkeyCodeBackendDomainSaveTeamOIDCConfigReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCTestResp;
        },
        any
      >({
        path: `/api/v1/teams/oidc/test`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前团队成员创建的项目列表
     *
     * @tags 【Team 管理员】团队项目
     * @name V1TeamsProjectsList
     * @summary 获取团队项目列表
     * @request GET:/api/v1/teams/projects
     * @secure
     */
    v1TeamsProjectsList: (
      query?: {
        /** 分页游标 */
        cursor?: string;
        /** 每页数量 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamProjectListResp;
        },
        any
      >({
        path: `/api/v1/teams/projects`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】Skill 管理
     * @name V1TeamsSkillsList
     * @summary 获取团队 Skill 列表
     * @request GET:/api/v1/teams/skills
     * @secure
     */
    v1TeamsSkillsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainListTeamSkillsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/skills`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】Skill 管理
     * @name V1TeamsSkillsCreate
     * @summary 添加团队 Skill (JSON)
     * @request POST:/api/v1/teams/skills
     * @secure
     */
    v1TeamsSkillsCreate: (req: GithubComChaitinMonkeyCodeBackendDomainAddTeamSkillReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamSkill;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/skills`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags 【Team 管理员】Skill 管理
     * @name V1TeamsSkillsPackageCreate
     * @summary 添加团队 Skill (multipart zip)
     * @request POST:/api/v1/teams/skills/package
     * @secure
     */
    v1TeamsSkillsPackageCreate: (
      data: {
        /** Skill 名称 */
        name: string;
        /** Skill 描述 */
        description: string;
        /** JSON 字符串数组 */
        tags?: string;
        /** SKILL.md 原文(可选) */
        content?: string;
        /** JSON 字符串数组 */
        group_ids?: string;
        /** zip 内 SKILL.md 路径 */
        skill_md_path?: string;
        /**
         * Skill zip 包
         * @format binary
         */
        file: File;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamSkill;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/skills/package`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 请求参数的 content 非空时，后端将 SKILL.md 重新打包上传 OSS 并创建新的 agent_skill_versions 并切到 active version 到新版本，否则仅更新当前版本的 description / tags / is_force_delivery / group_ids
     *
     * @tags 【Team 管理员】Skill 管理
     * @name V1TeamsSkillsUpdate
     * @summary 更新团队 Skill
     * @request PUT:/api/v1/teams/skills/{skill_id}
     * @secure
     */
    v1TeamsSkillsUpdate: (
      skillId: string,
      req: GithubComChaitinMonkeyCodeBackendDomainUpdateTeamSkillReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamSkill;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/skills/${skillId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 从本团队 skill repo 中软删所选 agent skill
     *
     * @tags 【Team 管理员】Skill 管理
     * @name V1TeamsSkillsDelete
     * @summary 删除团队 Skill
     * @request DELETE:/api/v1/teams/skills/{skill_id}
     * @secure
     */
    v1TeamsSkillsDelete: (skillId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/skills/${skillId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前团队任务创建开发环境的空闲休眠和回收策略
     *
     * @tags 【Team 管理员】开发环境管理
     * @name V1TeamsTaskVmIdlePolicyList
     * @summary 获取任务开发环境空闲策略
     * @request GET:/api/v1/teams/task-vm-idle-policy
     * @secure
     */
    v1TeamsTaskVmIdlePolicyList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamTaskVMIdlePolicy;
        },
        any
      >({
        path: `/api/v1/teams/task-vm-idle-policy`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新当前团队任务创建开发环境的空闲休眠和回收策略
     *
     * @tags 【Team 管理员】开发环境管理
     * @name V1TeamsTaskVmIdlePolicyUpdate
     * @summary 更新任务开发环境空闲策略
     * @request PUT:/api/v1/teams/task-vm-idle-policy
     * @secure
     */
    v1TeamsTaskVmIdlePolicyUpdate: (
      req: GithubComChaitinMonkeyCodeBackendDomainUpdateTeamTaskVMIdlePolicyReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamTaskVMIdlePolicy;
        },
        any
      >({
        path: `/api/v1/teams/task-vm-idle-policy`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前团队成员创建的任务列表
     *
     * @tags 【Team 管理员】团队任务
     * @name V1TeamsTasksList
     * @summary 获取团队任务列表
     * @request GET:/api/v1/teams/tasks
     * @secure
     */
    v1TeamsTasksList: (
      query?: {
        /** 分页游标 */
        cursor?: string;
        /** 每页数量 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamTaskListResp;
        },
        any
      >({
        path: `/api/v1/teams/tasks`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队成员列表，支持按角色筛选
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersList
     * @summary 获取团队成员列表
     * @request GET:/api/v1/teams/users
     * @secure
     */
    v1TeamsUsersList: (
      query?: {
        /** 团队成员角色筛选（可选值：admin, user） */
        role?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainMemberListResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建团队成员，发送重置密码邮件
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersCreate
     * @summary 创建团队成员
     * @request POST:/api/v1/teams/users
     * @secure
     */
    v1TeamsUsersCreate: (req: DomainAddTeamUserReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainAddTeamUserResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 团队用户登录，password 字段需要传 MD5 加密后的值
     *
     * @tags 【Team 管理员】认证
     * @name V1TeamsUsersLoginCreate
     * @summary 团队用户登录
     * @request POST:/api/v1/teams/users/login
     */
    v1TeamsUsersLoginCreate: (req: DomainTeamLoginReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamUser;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users/login`,
        method: "POST",
        body: req,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 团队用户登出
     *
     * @tags 【Team 管理员】认证
     * @name V1TeamsUsersLogoutCreate
     * @summary 团队用户登出
     * @request POST:/api/v1/teams/users/logout
     * @secure
     */
    v1TeamsUsersLogoutCreate: (params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/users/logout`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 修改当前用户的密码
     *
     * @tags 【Team 管理员】认证
     * @name V1TeamsUsersPasswordsChangeUpdate
     * @summary 修改密码
     * @request PUT:/api/v1/teams/users/passwords/change
     * @secure
     */
    v1TeamsUsersPasswordsChangeUpdate: (req: DomainChangePasswordReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/teams/users/passwords/change`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取团队用户登录状态
     *
     * @tags 【Team 管理员】认证
     * @name V1TeamsUsersStatusList
     * @summary 获取团队用户登录状态
     * @request GET:/api/v1/teams/users/status
     * @secure
     */
    v1TeamsUsersStatusList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamUser;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users/status`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建团队成员，后端生成初始密码并只在响应中返回一次
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersWithPasswordCreate
     * @summary 创建团队成员并返回初始密码
     * @request POST:/api/v1/teams/users/with-password
     * @secure
     */
    v1TeamsUsersWithPasswordCreate: (req: DomainAddTeamUserReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainAddTeamUserWithPasswordResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users/with-password`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新团队成员信息
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersUpdate
     * @summary 更新团队成员
     * @request PUT:/api/v1/teams/users/{user_id}
     * @secure
     */
    v1TeamsUsersUpdate: (userId: string, req: DomainUpdateTeamUserReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainUpdateTeamUserResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users/${userId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 软删除团队成员或管理员，不删除团队成员关系
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersDelete
     * @summary 删除团队成员
     * @request DELETE:/api/v1/teams/users/{user_id}
     * @secure
     */
    v1TeamsUsersDelete: (userId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/teams/users/${userId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 管理员为团队成员生成新密码，密码只在响应中返回一次
     *
     * @tags 【Team 管理员】分组成员管理
     * @name V1TeamsUsersPasswordsResetUpdate
     * @summary 重置团队成员密码
     * @request PUT:/api/v1/teams/users/{user_id}/passwords/reset
     * @secure
     */
    v1TeamsUsersPasswordsResetUpdate: (userId: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamUserPassword;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/teams/users/${userId}/passwords/reset`,
        method: "PUT",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 通用文件上传接口，支持图片和文件上传到 OSS。上传成功后返回文件的访问 URL。
     *
     * @tags 【上传】上传
     * @name V1UploaderCreate
     * @summary 文件上传
     * @request POST:/api/v1/uploader
     * @secure
     */
    v1UploaderCreate: (
      data: {
        /** 上传用途，可选值: avatar(头像), spec(规格), repo(仓库) */
        usage: string;
        /**
         * 要上传的文件
         * @format binary
         */
        file: File;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: string;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/uploader`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取临时文件上传 URL，客户端使用 `upload_url` 通过 PUT 直传 OSS，上传完成后将 `access_url` 作为任务创建或 user-input 的 `attachment_urls` 使用。 请求只需要 `filename`；旧客户端多传 `usage` 会被忽略。预签名 URL 固定 10 分钟过期，过期只影响 URL 可用性，不代表 OSS 对象自动删除。
     *
     * @tags 【上传】上传
     * @name V1UploaderPresignCreate
     * @summary 获取临时文件预签名上传URL
     * @request POST:/api/v1/uploader/presign
     * @secure
     */
    v1UploaderPresignCreate: (request: DomainPresignReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainPresignResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/uploader/presign`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新用户昵称和头像
     *
     * @tags 【用户】用户
     * @name V1UsersUpdate
     * @summary 更新用户信息
     * @request PUT:/api/v1/users
     * @secure
     */
    v1UsersUpdate: (
      data: {
        /** 昵称 */
        name?: string;
        /** OSS 头像地址 */
        avatar_url?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainUpdateUserResp;
        },
        any
      >({
        path: `/api/v1/users`,
        method: "PUT",
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 永久删除当前账号及关联个人数据，并撤销 Apple 登录授权（仅 Apple 登录的账号可用）
     *
     * @tags 【用户】认证
     * @name V1UsersAccountDelete
     * @summary 注销账号
     * @request DELETE:/api/v1/users/account
     * @secure
     */
    v1UsersAccountDelete: (params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, any>({
        path: `/api/v1/users/account`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 用 Apple 下发的 identity token 登录，首次登录自动建号
     *
     * @tags 【用户】认证
     * @name V1UsersAppleLoginCreate
     * @summary Apple 登录
     * @request POST:/api/v1/users/apple-login
     */
    v1UsersAppleLoginCreate: (req: DomainAppleLoginReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainUser;
        },
        any
      >({
        path: `/api/v1/users/apple-login`,
        method: "POST",
        body: req,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 处理百智云登录回调，验证 token 并建立会话
     *
     * @tags 【用户】认证
     * @name V1UsersBaizhiCallbackList
     * @summary 百智云登录回调
     * @request GET:/api/v1/users/baizhi/callback
     */
    v1UsersBaizhiCallbackList: (
      query: {
        /** 百智云返回的授权码 */
        code: string;
        /** 用户原本想访问的页面 */
        state?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/users/baizhi/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 用户已登录状态下请求绑定邮箱，系统发送验证邮件
     *
     * @tags 【用户】邮箱绑定
     * @name V1UsersEmailBindRequestUpdate
     * @summary 发送邮箱绑定验证邮件
     * @request PUT:/api/v1/users/email/bind-request
     * @secure
     */
    v1UsersEmailBindRequestUpdate: (req: DomainSendBindEmailVerificationReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/email/bind-request`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除文件/目录
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesDelete
     * @summary 删除文件/目录
     * @request DELETE:/api/v1/users/files
     * @secure
     */
    v1UsersFilesDelete: (
      query: {
        /** 虚拟机 id */
        id: string;
        /** 文件/目录路径 */
        path: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files`,
        method: "DELETE",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 复制文件/目录
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesCopyCreate
     * @summary 复制文件/目录
     * @request POST:/api/v1/users/files/copy
     * @secure
     */
    v1UsersFilesCopyCreate: (param: DomainFileChangeReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files/copy`,
        method: "POST",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 下载文件
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesDownloadList
     * @summary 下载文件
     * @request GET:/api/v1/users/files/download
     * @secure
     */
    v1UsersFilesDownloadList: (
      query: {
        /** 虚拟机 id */
        id: string;
        /** 文件/目录路径 */
        path: string;
        /** 下载文件名 */
        filename?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files/download`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 移动文件/目录
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesMoveUpdate
     * @summary 移动文件/目录
     * @request PUT:/api/v1/users/files/move
     * @secure
     */
    v1UsersFilesMoveUpdate: (param: DomainFileChangeReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files/move`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 保存文件内容
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesSaveUpdate
     * @summary 保存文件内容
     * @request PUT:/api/v1/users/files/save
     * @secure
     */
    v1UsersFilesSaveUpdate: (param: DomainFileSaveReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files/save`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 上传文件
     *
     * @tags 【用户】文件管理
     * @name V1UsersFilesUploadCreate
     * @summary 上传文件
     * @request POST:/api/v1/users/files/upload
     * @secure
     */
    v1UsersFilesUploadCreate: (
      query: {
        /** 虚拟机 id */
        id: string;
        /** 文件上传的绝对地址 */
        path: string;
      },
      data: {
        /** 文件 */
        file: File;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/files/upload`,
        method: "POST",
        query: query,
        body: data,
        secure: true,
        type: ContentType.FormData,
        format: "json",
        ...params,
      }),

    /**
     * @description 目录列表
     *
     * @tags 【用户】文件管理
     * @name V1UsersFoldersList
     * @summary 目录列表
     * @request GET:/api/v1/users/folders
     * @secure
     */
    v1UsersFoldersList: (
      query: {
        /** 虚拟机 id */
        id: string;
        /** 文件/目录路径 */
        path: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendPkgTaskflowFile[];
        },
        any
      >({
        path: `/api/v1/users/folders`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建目录
     *
     * @tags 【用户】文件管理
     * @name V1UsersFoldersCreate
     * @summary 创建目录
     * @request POST:/api/v1/users/folders
     * @secure
     */
    v1UsersFoldersCreate: (param: DomainFilePathReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/folders`,
        method: "POST",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Git Bot 列表
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsList
     * @summary Git Bot 列表
     * @request GET:/api/v1/users/git-bots
     * @secure
     */
    v1UsersGitBotsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListGitBotResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-bots`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新 Git Bot
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsUpdate
     * @summary 更新 Git Bot
     * @request PUT:/api/v1/users/git-bots
     * @secure
     */
    v1UsersGitBotsUpdate: (req: DomainUpdateGitBotReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/git-bots`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建 Git Bot
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsCreate
     * @summary 创建 Git Bot
     * @request POST:/api/v1/users/git-bots
     * @secure
     */
    v1UsersGitBotsCreate: (req: DomainCreateGitBotReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainGitBot;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-bots`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 分享 Git Bot
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsShareCreate
     * @summary 分享 Git Bot
     * @request POST:/api/v1/users/git-bots/share
     * @secure
     */
    v1UsersGitBotsShareCreate: (req: DomainShareGitBotReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/git-bots/share`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Git Bot 任务列表，支持分页
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsTasksList
     * @summary Git Bot 任务列表
     * @request GET:/api/v1/users/git-bots/tasks
     * @secure
     */
    v1UsersGitBotsTasksList: (
      query?: {
        /** 指定 Git Bot ID，不传则查全部 */
        id?: string;
        /** 下一页标识 */
        next_token?: string;
        /** 分页 */
        page?: number;
        /** 每页多少条记录 */
        size?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListGitBotTaskResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-bots/tasks`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除 Git Bot
     *
     * @tags 【用户】Git Bot
     * @name V1UsersGitBotsDelete
     * @summary 删除 Git Bot
     * @request DELETE:/api/v1/users/git-bots/{id}
     * @secure
     */
    v1UsersGitBotsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/git-bots/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前用户的 Git 身份认证列表
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesList
     * @summary 列表
     * @request GET:/api/v1/users/git-identities
     * @secure
     */
    v1UsersGitIdentitiesList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainGitIdentity[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-identities`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 添加 Git 身份认证
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesCreate
     * @summary 添加
     * @request POST:/api/v1/users/git-identities
     * @secure
     */
    v1UsersGitIdentitiesCreate: (req: DomainAddGitIdentityReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainGitIdentity;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-identities`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 根据 Git 身份获取指定仓库的分支列表
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesBranchesDetail
     * @summary 获取仓库分支列表
     * @request GET:/api/v1/users/git-identities/{identity_id}/{escaped_repo_full_name}/branches
     * @secure
     */
    v1UsersGitIdentitiesBranchesDetail: (
      identityId: string,
      escapedRepoFullName: string,
      query?: {
        /** 页码（默认1） */
        page?: number;
        /** 每页数量（默认50，最大100） */
        per_page?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainBranch[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-identities/${identityId}/${escapedRepoFullName}/branches`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取单个 Git 身份认证详情
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesDetail
     * @summary 详情
     * @request GET:/api/v1/users/git-identities/{id}
     * @secure
     */
    v1UsersGitIdentitiesDetail: (
      id: string,
      query?: {
        /** 是否刷新缓存 */
        flush?: boolean;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainGitIdentity;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/git-identities/${id}`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新 Git 身份认证
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesUpdate
     * @summary 更新
     * @request PUT:/api/v1/users/git-identities/{id}
     * @secure
     */
    v1UsersGitIdentitiesUpdate: (id: string, req: DomainUpdateGitIdentityReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/git-identities/${id}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除 Git 身份认证
     *
     * @tags 【用户】git 身份管理
     * @name V1UsersGitIdentitiesDelete
     * @summary 删除
     * @request DELETE:/api/v1/users/git-identities/{id}
     * @secure
     */
    v1UsersGitIdentitiesDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/git-identities/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取主机列表
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsList
     * @summary 获取主机列表
     * @request GET:/api/v1/users/hosts
     * @secure
     */
    v1UsersHostsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainHostListResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取绑定宿主机命令
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsInstallCommandList
     * @summary 获取绑定宿主机命令
     * @request GET:/api/v1/users/hosts/install-command
     * @secure
     */
    v1UsersHostsInstallCommandList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainInstallCommand;
        },
        any
      >({
        path: `/api/v1/users/hosts/install-command`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 修改虚拟机
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsUpdate
     * @summary 修改虚拟机
     * @request PUT:/api/v1/users/hosts/vms
     * @secure
     */
    v1UsersHostsVmsUpdate: (req: DomainUpdateVMReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainVirtualMachine;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建虚拟机
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsCreate
     * @summary 创建虚拟机
     * @request POST:/api/v1/users/hosts/vms
     * @secure
     */
    v1UsersHostsVmsCreate: (request: DomainCreateVMReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainVirtualMachine;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 通过 WebSocket 加入终端
     *
     * @tags 【用户】终端连接管理
     * @name V1UsersHostsVmsTerminalsJoinList
     * @summary 通过 WebSocket 加入终端
     * @request GET:/api/v1/users/hosts/vms/terminals/join
     * @secure
     */
    v1UsersHostsVmsTerminalsJoinList: (
      query?: {
        col?: number;
        /** 加入终端的密码 */
        password?: string;
        row?: number;
        /** 终端 id, 用于唯一标识一个 session */
        terminal_id?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainShareTerminalResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms/terminals/join`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取虚拟机详情
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsDetail
     * @summary 获取虚拟机详情
     * @request GET:/api/v1/users/hosts/vms/{id}
     * @secure
     */
    v1UsersHostsVmsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainVirtualMachine;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms/${id}`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取虚拟机终端session列表
     *
     * @tags 【用户】终端连接管理
     * @name V1UsersHostsVmsTerminalsDetail
     * @summary 获取虚拟机终端session列表
     * @request GET:/api/v1/users/hosts/vms/{id}/terminals
     * @secure
     */
    v1UsersHostsVmsTerminalsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTerminal[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms/${id}/terminals`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 通过 WebSocket 连接到指定虚拟机的终端，支持双向通信
     *
     * @tags 【用户】终端连接管理
     * @name V1UsersHostsVmsTerminalsConnectDetail
     * @summary 连接虚拟机终端
     * @request GET:/api/v1/users/hosts/vms/{id}/terminals/connect
     * @secure
     */
    v1UsersHostsVmsTerminalsConnectDetail: (
      id: string,
      query?: {
        /** 终端ID */
        terminal_id?: string;
        /**
         * 终端列数
         * @default 80
         */
        col?: number;
        /**
         * 终端行数
         * @default 24
         */
        row?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string | GithubComGoYokoWebResp>({
        path: `/api/v1/users/hosts/vms/${id}/terminals/connect`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 分享终端
     *
     * @tags 【用户】终端连接管理
     * @name V1UsersHostsVmsTerminalsShareCreate
     * @summary 分享终端
     * @request POST:/api/v1/users/hosts/vms/{id}/terminals/share
     * @secure
     */
    v1UsersHostsVmsTerminalsShareCreate: (id: string, request: DomainShareTerminalReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainShareTerminalResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms/${id}/terminals/share`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 关闭虚拟机终端session
     *
     * @tags 【用户】终端连接管理
     * @name V1UsersHostsVmsTerminalsDelete
     * @summary 关闭虚拟机终端session
     * @request DELETE:/api/v1/users/hosts/vms/{id}/terminals/{terminal_id}
     * @secure
     */
    v1UsersHostsVmsTerminalsDelete: (id: string, terminalId: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTerminal[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/vms/${id}/terminals/${terminalId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除虚拟机
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsDelete
     * @summary 删除虚拟机
     * @request DELETE:/api/v1/users/hosts/{host_id}/vms/{id}
     * @secure
     */
    v1UsersHostsVmsDelete: (hostId: string, id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/hosts/${hostId}/vms/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 列出开发环境的监听端口
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsPortsDetail
     * @summary 列出开发环境的监听端口
     * @request GET:/api/v1/users/hosts/{host_id}/vms/{id}/ports
     * @secure
     */
    v1UsersHostsVmsPortsDetail: (hostId: string, id: string, request: DomainApplyPortReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainVMPort[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/${hostId}/vms/${id}/ports`,
        method: "GET",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为开发环境申请一个端口
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsPortsCreate
     * @summary 申请端口
     * @request POST:/api/v1/users/hosts/{host_id}/vms/{id}/ports
     * @secure
     */
    v1UsersHostsVmsPortsCreate: (hostId: string, id: string, request: DomainApplyPortReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainVMPort;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/hosts/${hostId}/vms/${id}/ports`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为开发环境回收一个端口
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsVmsPortsDelete
     * @summary 回收端口
     * @request DELETE:/api/v1/users/hosts/{host_id}/vms/{id}/ports/{port}
     * @secure
     */
    v1UsersHostsVmsPortsDelete: (
      hostId: string,
      id: string,
      port: string,
      request: DomainRecyclePortReq,
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/hosts/${hostId}/vms/${id}/ports/${port}`,
        method: "DELETE",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新宿主机
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsUpdate
     * @summary 更新宿主机
     * @request PUT:/api/v1/users/hosts/{id}
     * @secure
     */
    v1UsersHostsUpdate: (id: string, request: DomainUpdateHostReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/hosts/${id}`,
        method: "PUT",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除宿主机
     *
     * @tags 【用户】主机管理
     * @name V1UsersHostsDelete
     * @summary 删除宿主机
     * @request DELETE:/api/v1/users/hosts/{id}
     * @secure
     */
    v1UsersHostsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/hosts/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前登录用户的所有镜像配置
     *
     * @tags 【用户】镜像管理
     * @name V1UsersImagesList
     * @summary 获取当前用户的镜像配置列表
     * @request GET:/api/v1/users/images
     * @secure
     */
    v1UsersImagesList: (
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListImageResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/images`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为当前用户创建新的镜像配置
     *
     * @tags 【用户】镜像管理
     * @name V1UsersImagesCreate
     * @summary 创建镜像配置
     * @request POST:/api/v1/users/images
     * @secure
     */
    v1UsersImagesCreate: (req: DomainCreateImageReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainImage;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/images`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新指定的镜像配置信息
     *
     * @tags 【用户】镜像管理
     * @name V1UsersImagesUpdate
     * @summary 更新镜像配置
     * @request PUT:/api/v1/users/images/{id}
     * @secure
     */
    v1UsersImagesUpdate: (id: string, request: DomainUpdateImageReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainImage;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/images/${id}`,
        method: "PUT",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除指定的镜像配置
     *
     * @tags 【用户】镜像管理
     * @name V1UsersImagesDelete
     * @summary 删除镜像配置
     * @request DELETE:/api/v1/users/images/{id}
     * @secure
     */
    v1UsersImagesDelete: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainDeleteImageReq;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/images/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 查询当前用户邀请的用户列表
     *
     * @tags 【用户】用户
     * @name V1UsersInvitationsList
     * @summary 邀请用户列表
     * @request GET:/api/v1/users/invitations
     */
    v1UsersInvitationsList: (
      query?: {
        /**
         * 页码
         * @default 1
         */
        page?: number;
        /**
         * 每页条数
         * @default 20
         */
        size?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainInvitationListResp;
        },
        any
      >({
        path: `/api/v1/users/invitations`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description 重定向到百智云OAuth授权页面进行登录认证
     *
     * @tags 【用户】认证
     * @name V1UsersLoginList
     * @summary 百智云OAuth登录
     * @request GET:/api/v1/users/login
     */
    v1UsersLoginList: (
      query?: {
        /** 登录成功后跳转的页面路径 */
        redirect?: string;
        /** 邀请人ID（可选），新用户注册时用于发放邀请奖励 */
        inviter_id?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, string>({
        path: `/api/v1/users/login`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 清除用户会话，登出系统
     *
     * @tags 【用户】认证
     * @name V1UsersLogoutCreate
     * @summary 用户登出
     * @request POST:/api/v1/users/logout
     */
    v1UsersLogoutCreate: (params: RequestParams = {}) =>
      this.request<Record<string, string>, any>({
        path: `/api/v1/users/logout`,
        method: "POST",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新当前登录用户指定 MCP Tool 的启用状态
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpToolsUpdate
     * @summary 更新当前用户的 MCP Tool 开关配置
     * @request PUT:/api/v1/users/mcp/tools/{id}
     * @secure
     */
    v1UsersMcpToolsUpdate: (
      id: string,
      req: GithubComChaitinMonkeyCodeBackendDomainUpdateUserMCPToolSettingReq,
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/mcp/tools/${id}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前登录用户可管理的 MCP Upstream 列表
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpUpstreamsList
     * @summary 获取当前用户的 MCP Upstream 列表
     * @request GET:/api/v1/users/mcp/upstreams
     * @secure
     */
    v1UsersMcpUpstreamsList: (
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainListUserMCPUpstreamsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/mcp/upstreams`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为当前登录用户创建自定义 MCP Upstream
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpUpstreamsCreate
     * @summary 创建当前用户的 MCP Upstream
     * @request POST:/api/v1/users/mcp/upstreams
     * @secure
     */
    v1UsersMcpUpstreamsCreate: (
      req: GithubComChaitinMonkeyCodeBackendDomainCreateUserMCPUpstreamReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainMCPUpstream;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/mcp/upstreams`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新当前登录用户指定的 MCP Upstream 配置
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpUpstreamsUpdate
     * @summary 更新当前用户的 MCP Upstream
     * @request PUT:/api/v1/users/mcp/upstreams/{id}
     * @secure
     */
    v1UsersMcpUpstreamsUpdate: (
      id: string,
      req: GithubComChaitinMonkeyCodeBackendDomainUpdateUserMCPUpstreamReq,
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/mcp/upstreams/${id}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除当前登录用户指定的 MCP Upstream
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpUpstreamsDelete
     * @summary 删除当前用户的 MCP Upstream
     * @request DELETE:/api/v1/users/mcp/upstreams/{id}
     * @secure
     */
    v1UsersMcpUpstreamsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/mcp/upstreams/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 触发当前登录用户指定 MCP Upstream 的工具同步
     *
     * @tags 【用户】MCP 配置
     * @name V1UsersMcpUpstreamsSyncCreate
     * @summary 同步当前用户的 MCP Upstream
     * @request POST:/api/v1/users/mcp/upstreams/{id}/sync
     * @secure
     */
    v1UsersMcpUpstreamsSyncCreate: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/mcp/upstreams/${id}/sync`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前用户所在团队的普通成员列表
     *
     * @tags 【用户】用户
     * @name V1UsersMembersList
     * @summary 获取团队成员列表
     * @request GET:/api/v1/users/members
     * @secure
     */
    v1UsersMembersList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainUser[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/members`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前登录用户的所有模型配置
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsList
     * @summary 获取当前用户的模型配置列表
     * @request GET:/api/v1/users/models
     * @secure
     */
    v1UsersModelsList: (
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListModelResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/models`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为当前用户创建新的模型配置
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsCreate
     * @summary 创建模型配置
     * @request POST:/api/v1/users/models
     * @secure
     */
    v1UsersModelsCreate: (req: DomainCreateModelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainModel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/models`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取模型列表及定价，模型等级仅用于选择每日模型额度池
     *
     * @tags 【用户】会员
     * @name V1UsersModelsAvailableList
     * @summary 获取可用模型列表
     * @request GET:/api/v1/users/models/available
     * @secure
     */
    v1UsersModelsAvailableList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainAvailableModelResp[];
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/models/available`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 使用提供的配置进行健康检查，不更新数据库
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsHealthCheckCreate
     * @summary 检查模型健康状态（通过配置）
     * @request POST:/api/v1/users/models/health-check
     * @secure
     */
    v1UsersModelsHealthCheckCreate: (req: DomainCheckByConfigReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainCheckModelResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/models/health-check`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取供应商支持的模型列表
     *
     * @tags 【用户】模型管理
     * @name GetProviderModelList
     * @summary 获取供应商支持的模型列表
     * @request GET:/api/v1/users/models/providers
     */
    getProviderModelList: (
      query: {
        api_header?: string;
        api_key: string;
        base_url: string;
        provider:
          | "SiliconFlow"
          | "OpenAI"
          | "Ollama"
          | "DeepSeek"
          | "Moonshot"
          | "AzureOpenAI"
          | "BaiZhiCloud"
          | "Hunyuan"
          | "BaiLian"
          | "Volcengine"
          | "Gemini";
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainGetProviderModelListResp;
        },
        any
      >({
        path: `/api/v1/users/models/providers`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新指定的模型配置信息
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsUpdate
     * @summary 更新模型配置
     * @request PUT:/api/v1/users/models/{id}
     * @secure
     */
    v1UsersModelsUpdate: (id: string, request: DomainUpdateModelReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/models/${id}`,
        method: "PUT",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除指定的模型配置
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsDelete
     * @summary 删除模型配置
     * @request DELETE:/api/v1/users/models/{id}
     * @secure
     */
    v1UsersModelsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/models/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 对指定模型进行健康检查，并更新检查结果到数据库
     *
     * @tags 【用户】模型管理
     * @name V1UsersModelsHealthCheckDetail
     * @summary 检查模型健康状态（通过ID）
     * @request GET:/api/v1/users/models/{id}/health-check
     * @secure
     */
    v1UsersModelsHealthCheckDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainCheckModelResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/models/${id}/health-check`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 列出当前用户的所有推送渠道及其订阅配置
     *
     * @tags 通知推送
     * @name V1UsersNotifyChannelsList
     * @summary 列出用户推送渠道
     * @request GET:/api/v1/users/notify/channels
     * @secure
     */
    v1UsersNotifyChannelsList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/notify/channels`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建用户推送渠道（钉钉/飞书/企业微信/Webhook），同时配置订阅的事件类型
     *
     * @tags 通知推送
     * @name V1UsersNotifyChannelsCreate
     * @summary 创建用户推送渠道
     * @request POST:/api/v1/users/notify/channels
     * @secure
     */
    v1UsersNotifyChannelsCreate: (param: DomainCreateNotifyChannelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/notify/channels`,
        method: "POST",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新用户推送渠道配置及订阅的事件类型
     *
     * @tags 通知推送
     * @name V1UsersNotifyChannelsUpdate
     * @summary 更新用户推送渠道
     * @request PUT:/api/v1/users/notify/channels/{id}
     * @secure
     */
    v1UsersNotifyChannelsUpdate: (id: string, param: DomainUpdateNotifyChannelReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainNotifyChannel;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/notify/channels/${id}`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除用户推送渠道及其关联的订阅
     *
     * @tags 通知推送
     * @name V1UsersNotifyChannelsDelete
     * @summary 删除用户推送渠道
     * @request DELETE:/api/v1/users/notify/channels/{id}
     * @secure
     */
    v1UsersNotifyChannelsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/notify/channels/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 发送测试消息验证渠道配置是否正确
     *
     * @tags 通知推送
     * @name V1UsersNotifyChannelsTestCreate
     * @summary 测试用户推送渠道
     * @request POST:/api/v1/users/notify/channels/{id}/test
     * @secure
     */
    v1UsersNotifyChannelsTestCreate: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/notify/channels/${id}/test`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 列出所有支持订阅的事件类型
     *
     * @tags 通知推送
     * @name V1UsersNotifyEventTypesList
     * @summary 列出事件类型
     * @request GET:/api/v1/users/notify/event-types
     * @secure
     */
    v1UsersNotifyEventTypesList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: ConstsNotifyEventTypeInfo[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/notify/event-types`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 根据 provider 生成第三方授权地址。provider 仅支持 google、github。redirect_url 可选，必须是站内相对路径；登录成功后后端会跳转到该路径，空值默认 /console/。
     *
     * @tags 【用户】OAuth
     * @name V1UsersOauthLoginDetail
     * @summary 发起 Google/GitHub OAuth 登录
     * @request GET:/api/v1/users/oauth/{provider}/login
     */
    v1UsersOauthLoginDetail: (
      provider: string,
      query?: {
        /** 登录成功后的站内跳转路径，例如 /console/tasks；只允许站内相对路径 */
        redirect_url?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainOAuthLoginResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/oauth/${provider}/login`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 处理身份源回调并创建 MonkeyCode 登录会话
     *
     * @tags 【用户】企业团队成员认证
     * @name V1UsersOidcCallbackList
     * @summary 处理团队 OIDC 回调
     * @request GET:/api/v1/users/oidc/callback
     */
    v1UsersOidcCallbackList: (
      query: {
        /** 授权码 */
        code: string;
        /** 状态 */
        state: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, any>({
        path: `/api/v1/users/oidc/callback`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 用于私有化登录页展示第一个已启用团队的企业登录入口
     *
     * @tags 【用户】企业团队成员认证
     * @name V1UsersOidcDefaultTeamList
     * @summary 获取默认团队公开 OIDC 登录配置
     * @request GET:/api/v1/users/oidc/default-team
     */
    v1UsersOidcDefaultTeamList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCPublicConfigResp;
        },
        any
      >({
        path: `/api/v1/users/oidc/default-team`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 根据 team_id 跳转到团队 OIDC 身份源
     *
     * @tags 【用户】企业团队成员认证
     * @name V1UsersOidcLoginList
     * @summary 发起团队 OIDC 登录
     * @request GET:/api/v1/users/oidc/login
     */
    v1UsersOidcLoginList: (
      query: {
        /** 团队 ID */
        team_id: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<any, any>({
        path: `/api/v1/users/oidc/login`,
        method: "GET",
        query: query,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 用于团队专属登录页展示企业登录入口
     *
     * @tags 【用户】企业团队成员认证
     * @name V1UsersOidcTeamsDetail
     * @summary 获取团队公开 OIDC 登录配置
     * @request GET:/api/v1/users/oidc/teams/{team_id}
     */
    v1UsersOidcTeamsDetail: (teamId: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTeamOIDCPublicConfigResp;
        },
        any
      >({
        path: `/api/v1/users/oidc/teams/${teamId}`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 密码登录
     *
     * @tags 【用户】企业团队成员认证
     * @name V1UsersPasswordLoginCreate
     * @summary 密码登录
     * @request POST:/api/v1/users/password-login
     */
    v1UsersPasswordLoginCreate: (req: DomainTeamLoginReq, params: RequestParams = {}) =>
      this.request<DomainTeamUserInfo, any>({
        path: `/api/v1/users/password-login`,
        method: "POST",
        body: req,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 通过传入的 token 查询账户信息
     *
     * @tags 【用户】密码管理
     * @name V1UsersPasswordsAccountsDetail
     * @summary 通过 token 查询账户信息
     * @request GET:/api/v1/users/passwords/accounts/{token}
     */
    v1UsersPasswordsAccountsDetail: (token: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamUserInfo;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/passwords/accounts/${token}`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 修改当前用户的密码
     *
     * @tags 【用户】认证
     * @name V1UsersPasswordsChangeUpdate
     * @summary 修改密码
     * @request PUT:/api/v1/users/passwords/change
     * @secure
     */
    v1UsersPasswordsChangeUpdate: (req: DomainChangePasswordReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/passwords/change`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 重置当前用户的密码
     *
     * @tags 【用户】密码管理
     * @name V1UsersPasswordsResetUpdate
     * @summary 重置密码
     * @request PUT:/api/v1/users/passwords/reset
     */
    v1UsersPasswordsResetUpdate: (req: DomainResetUserPasswordReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/passwords/reset`,
        method: "PUT",
        body: req,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 重置指定用户的密码，并发送重置邮件
     *
     * @tags 【用户】密码管理
     * @name V1UsersPasswordsResetRequestUpdate
     * @summary 发送重置密码邮件
     * @request PUT:/api/v1/users/passwords/reset-request
     */
    v1UsersPasswordsResetRequestUpdate: (req: DomainResetUserPasswordEmailReq, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/passwords/reset-request`,
        method: "PUT",
        body: req,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 百智云支付回调，验证签名后充值积分
     *
     * @tags 【用户】钱包
     * @name V1UsersPayNotifyList
     * @summary 支付回调通知
     * @request GET:/api/v1/users/pay/notify
     */
    v1UsersPayNotifyList: (params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, any>({
        path: `/api/v1/users/pay/notify`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 用户可以将普通帖子分享到广场，需要填写 title/content/image/code 内容
     *
     * @tags 【用户】广场
     * @name V1UsersPlaygroundNormalPostsCreate
     * @summary 分享普通帖子到广场
     * @request POST:/api/v1/users/playground-normal-posts
     * @secure
     */
    v1UsersPlaygroundNormalPostsCreate: (request: DomainSharePostReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainSharePostResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/playground-normal-posts`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取当前用户分享到广场的帖子，支持游标分页
     *
     * @tags 【用户】广场
     * @name V1UsersPlaygroundPostsList
     * @summary 获取自己的公开 Po 文列表
     * @request GET:/api/v1/users/playground-posts
     * @secure
     */
    v1UsersPlaygroundPostsList: (
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainListUserPlaygroundPostResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/playground-posts`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 用户可以将任务分享到广场，需要填写 content/image/code 内容
     *
     * @tags 【用户】广场
     * @name V1UsersPlaygroundTaskPostsCreate
     * @summary 分享任务到广场
     * @request POST:/api/v1/users/playground-task-posts/{task_id}
     * @secure
     */
    v1UsersPlaygroundTaskPostsCreate: (taskId: string, request: DomainShareTaskReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainShareTaskResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/playground-task-posts/${taskId}`,
        method: "POST",
        body: request,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 项目列表
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsList
     * @summary 项目列表
     * @request GET:/api/v1/users/projects
     * @secure
     */
    v1UsersProjectsList: (
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListProjectResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建项目
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsCreate
     * @summary 创建项目
     * @request POST:/api/v1/users/projects
     * @secure
     */
    v1UsersProjectsCreate: (req: DomainCreateProjectReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProject;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 项目详情
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsDetail
     * @summary 项目详情
     * @request GET:/api/v1/users/projects/{id}
     * @secure
     */
    v1UsersProjectsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProject;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新项目
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsUpdate
     * @summary 更新项目
     * @request PUT:/api/v1/users/projects/{id}
     * @secure
     */
    v1UsersProjectsUpdate: (id: string, req: DomainUpdateProjectReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProject;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除项目
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsDelete
     * @summary 删除项目
     * @request DELETE:/api/v1/users/projects/{id}
     * @secure
     */
    v1UsersProjectsDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/projects/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 开启自动审查
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsAutoReviewCreate
     * @summary 开启自动审查
     * @request POST:/api/v1/users/projects/{id}/auto-review
     * @secure
     */
    v1UsersProjectsAutoReviewCreate: (id: string, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainProject;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/projects/${id}/auto-review`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 关闭自动审查
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsAutoReviewDelete
     * @summary 关闭自动审查
     * @request DELETE:/api/v1/users/projects/{id}/auto-review
     * @secure
     */
    v1UsersProjectsAutoReviewDelete: (id: string, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/users/projects/${id}/auto-review`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 协作者列表
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsCollaboratorsDetail
     * @summary 协作者列表
     * @request GET:/api/v1/users/projects/{id}/collaborators
     * @secure
     */
    v1UsersProjectsCollaboratorsDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListCollaboratorsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/collaborators`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 问题列表
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesDetail
     * @summary 问题列表
     * @request GET:/api/v1/users/projects/{id}/issues
     * @secure
     */
    v1UsersProjectsIssuesDetail: (
      id: string,
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListIssuesResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/issues`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建问题
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesCreate
     * @summary 创建问题
     * @request POST:/api/v1/users/projects/{id}/issues
     * @secure
     */
    v1UsersProjectsIssuesCreate: (id: string, req: DomainCreateIssueReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectIssue;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/issues`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新问题
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesUpdate
     * @summary 更新问题
     * @request PUT:/api/v1/users/projects/{id}/issues/{issue_id}
     * @secure
     */
    v1UsersProjectsIssuesUpdate: (id: string, issueId: string, req: DomainUpdateIssueReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectIssue;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/issues/${issueId}`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除问题
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesDelete
     * @summary 删除问题
     * @request DELETE:/api/v1/users/projects/{id}/issues/{issue_id}
     * @secure
     */
    v1UsersProjectsIssuesDelete: (id: string, issueId: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/projects/${id}/issues/${issueId}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 问题评论列表
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesCommentsDetail
     * @summary 问题评论列表
     * @request GET:/api/v1/users/projects/{id}/issues/{issue_id}/comments
     * @secure
     */
    v1UsersProjectsIssuesCommentsDetail: (
      id: string,
      issueId: string,
      query?: {
        /** 游标，首页传空。下一页回传回包中的 cursor */
        cursor?: string;
        /** 页数 */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListIssueCommentsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/issues/${issueId}/comments`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建问题评论
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsIssuesCommentsCreate
     * @summary 创建问题评论
     * @request POST:/api/v1/users/projects/{id}/issues/{issue_id}/comments
     * @secure
     */
    v1UsersProjectsIssuesCommentsCreate: (
      id: string,
      issueId: string,
      req: DomainCreateIssueCommentReq,
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectIssueComment;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/issues/${issueId}/comments`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取项目仓库树
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsTreeDetail
     * @summary 获取项目仓库树
     * @request GET:/api/v1/users/projects/{id}/tree
     * @secure
     */
    v1UsersProjectsTreeDetail: (
      id: string,
      query?: {
        /** 是否递归 */
        recursive?: boolean;
        /** 分支 */
        ref?: string;
        /** 路径 */
        path?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectTreeEntry[];
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/tree`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取项目仓库压缩包
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsTreeArchiveDetail
     * @summary 获取项目仓库压缩包
     * @request GET:/api/v1/users/projects/{id}/tree/archive
     * @secure
     */
    v1UsersProjectsTreeArchiveDetail: (
      id: string,
      query?: {
        /** 分支 */
        ref?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<File, GithubComGoYokoWebResp>({
        path: `/api/v1/users/projects/${id}/tree/archive`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 获取项目文件内容
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsTreeBlobDetail
     * @summary 获取项目文件内容
     * @request GET:/api/v1/users/projects/{id}/tree/blob
     * @secure
     */
    v1UsersProjectsTreeBlobDetail: (
      id: string,
      query: {
        /** 文件路径 */
        path: string;
        /** 分支 */
        ref?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectBlob;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/tree/blob`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取项目仓库日志
     *
     * @tags 【用户】项目管理
     * @name V1UsersProjectsTreeLogsDetail
     * @summary 获取项目仓库日志
     * @request GET:/api/v1/users/projects/{id}/tree/logs
     * @secure
     */
    v1UsersProjectsTreeLogsDetail: (
      id: string,
      query?: {
        /** 分支 */
        ref?: string;
        /** 路径 */
        path?: string;
        /** 限制数量 */
        limit?: number;
        /** 偏移量 */
        offset?: number;
        /** 起始 SHA */
        since_sha?: string;
        /** 结束 SHA */
        until_sha?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectLogs;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/projects/${id}/tree/logs`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 检查当前用户是否已登录，返回认证状态和用户信息
     *
     * @tags 【用户】认证
     * @name V1UsersStatusList
     * @summary 检查用户登录状态
     * @request GET:/api/v1/users/status
     */
    v1UsersStatusList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTeamUserInfo;
        },
        any
      >({
        path: `/api/v1/users/status`,
        method: "GET",
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 开源版固定返回基础订阅状态
     *
     * @tags 【用户】会员
     * @name V1UsersSubscriptionList
     * @summary 查询当前会员状态
     * @request GET:/api/v1/users/subscription
     * @secure
     */
    v1UsersSubscriptionList: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainSubscriptionResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/subscription`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 会员购买请使用钱包充值下单接口，本接口不再作为购买入口
     *
     * @tags 【用户】会员
     * @name V1UsersSubscriptionCreate
     * @summary 购买会员
     * @request POST:/api/v1/users/subscription
     * @secure
     */
    v1UsersSubscriptionCreate: (req: DomainSubscribeReq, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/users/subscription`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 设置专业会员自动续费开关
     *
     * @tags 【用户】会员
     * @name V1UsersSubscriptionAutoRenewUpdate
     * @summary 开关自动续费
     * @request PUT:/api/v1/users/subscription/auto-renew
     * @secure
     */
    v1UsersSubscriptionAutoRenewUpdate: (req: DomainAutoRenewReq, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/users/subscription/auto-renew`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 关闭后，基础/专业/旗舰模型当日免费 Tokens 耗尽时不再消耗积分
     *
     * @tags 【用户】会员
     * @name V1UsersSubscriptionCreditConsumptionUpdate
     * @summary 开关免费额度耗尽后的积分消费
     * @request PUT:/api/v1/users/subscription/credit-consumption
     * @secure
     */
    v1UsersSubscriptionCreditConsumptionUpdate: (req: DomainCreditConsumptionReq, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/users/subscription/credit-consumption`,
        method: "PUT",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 获取属于该用户的所有任务，仅支持普通分页
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksList
     * @summary 任务列表
     * @request GET:/api/v1/users/tasks
     * @secure
     */
    v1UsersTasksList: (
      query?: {
        /** 下一页标识 */
        next_token?: string;
        /** 分页 */
        page?: number;
        /** 用于筛选项目相关的任务 */
        project_id?: string;
        /** 只筛选快速启动的项目无关任务 */
        quick_start?: boolean;
        /** 每页多少条记录 */
        size?: number;
        status?: "pending" | "processing" | "error" | "finished";
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainListTaskResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/tasks`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 创建任务 `attachments` 为可选附件列表，最多 10 个；每项包含 `url` 和 `filename`，URL 需要匹配后端配置的附件白名单前缀。创建任务后，首轮 user-input 日志会按 `{ "content": "base64文本", "attachments": [] }` 结构返回。
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksCreate
     * @summary 创建任务
     * @request POST:/api/v1/users/tasks
     * @secure
     */
    v1UsersTasksCreate: (param: DomainCreateTaskReq, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainProjectTask;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/tasks`,
        method: "POST",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 domain.TaskStream）： ```json { "type": "string", "data": "string", "kind": "string", "timestamp": 0 } ``` 独立于 stream 的长生命周期 WebSocket 连接，用于处理 call/call-response（文件浏览、diff 查看等同步请求）。 task 结束后连接不断开，仍可用于文件操作。 支持同一 taskID 多 tab 并发连接。 ## 上行消息 ### Type=call, Kind=repo_file_diff — 获取文件 diff 请求 Data: ```json {"request_id":"string","path":"string","unified":true,"context_lines":3} ``` 响应 Data: ```json {"request_id":"string","path":"string","diff":"string","success":true,"error":"string?"} ``` ### Type=call, Kind=repo_file_list — 列出目录文件 请求 Data: ```json {"request_id":"string","path":"string","glob_pattern":"string?","include_hidden":false} ``` 响应 Data: ```json {"request_id":"string","path":"string","files":[{"name":"string","path":"string","entry_mode":0,"size":0,"modified_at":0}],"success":true,"error":"string?"} ``` ### Type=call, Kind=repo_read_file — 读取文件内容 请求 Data: ```json {"request_id":"string","path":"string","offset":0,"length":0} ``` 响应 Data: ```json {"request_id":"string","path":"string","content":"bytes","total_size":0,"offset":0,"length":0,"is_truncated":false,"success":true,"error":"string?"} ``` ### Type=call, Kind=repo_file_changes — 查询变更文件列表 请求 Data: ```json {"request_id":"string"} ``` 响应 Data: ```json {"request_id":"string","changes":[{"path":"string","status":"string","additions":0,"deletions":0,"old_path":"string?"}],"branch":"string?","commit_hash":"string?","success":true,"error":"string?"} ``` ### Type=call, Kind=port_forward_list — 获取端口转发列表 请求 Data: ```json {"request_id":"string"} ``` 响应 Data: ```json {"request_id":"string","ports":[{"port":0,"status":"string","process":"string","forward_id":"string?","access_url":"string?","label":"string?","error_message":"string?","whitelist_ips":["string"]}]} ``` ### Type=call, Kind=restart — 重启任务 请求 Data: ```json {"request_id":"string","load_session":true} ``` 响应 Data: ```json {"id":"uuid","request_id":"string?","success":true,"message":"string","session_id":"string"} ``` ### Type=call, Kind=switch_model — 切换运行中任务模型 请求 Data: ```json {"request_id":"string","model_id":"uuid","load_session":true} ``` 响应 Data: ```json {"id":"uuid","request_id":"string?","success":true,"message":"string","session_id":"string","model":{}} ``` ### Type=sync-my-ip — 同步 Web 客户端真实 IP 请求 Data: ```json {"client_ip":"string"} ``` ## 下行消息 - Type=call-response: 同步请求响应（Kind 与请求一致）。失败时 Data 为: ```json {"request_id":"string","success":false,"error":"string"} ``` - Type=task-event: 任务事件（从 TaskLive 订阅转发） - Type=ping: 心跳（无 Data）
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksControlList
     * @summary 任务控制流 WebSocket
     * @request GET:/api/v1/users/tasks/control
     * @secure
     */
    v1UsersTasksControlList: (
      query: {
        /** 任务 ID */
        id: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/control`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 数据格式约定参考任务数据流 WebSocket 接口
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksPublicStreamList
     * @summary 公开的任务数据流 WebSocket
     * @request GET:/api/v1/users/tasks/public-stream
     * @secure
     */
    v1UsersTasksPublicStreamList: (
      query: {
        /** 任务 ID */
        id: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/public-stream`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 根据 cursor 翻页查询任务的历史轮次。limit 为轮次数（非条目数）， limit=2 表示返回 2 轮的完整消息。direction=backward（默认）从 cursor 往更早翻，轮间倒序（最新轮在前）； direction=forward 往更新翻，轮间正序（最旧轮在前）；轮内消息始终按时间正序。 即响应中最后一轮总是与 next_cursor 相邻的那一轮。前端应以每条 chunk 的 seq 做分组排序，不依赖数组顺序。 日志存储为 ClickHouse 时 cursor 即轮次号 seq，可配合 inclusive=true 实现"跳转到第 seq 轮"； Loki 仅支持 backward 且不支持 inclusive，违反时返回 err-task-rounds-direction-unsupported。 返回的 user-input.data 统一为 JSON payload 字符串，例如 `{"content":"57un57ut5aSE55CG","attachments":[]}`；content 为用户输入文本的 base64 编码，旧历史裸文本也会按该结构包装返回。
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksRoundsList
     * @summary 查询任务历史轮次
     * @request GET:/api/v1/users/tasks/rounds
     * @secure
     */
    v1UsersTasksRoundsList: (
      query: {
        /** 任务 ID */
        id: string;
        /** 分页游标（ClickHouse 下即轮次号 seq） */
        cursor?: string;
        /** 轮次数（默认 2，上限 10） */
        limit?: number;
        /** 翻页方向：backward（默认）/ forward */
        direction?: string;
        /** 是否包含 cursor 指向的那一轮（跳转定位用） */
        inclusive?: boolean;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTaskRoundsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/tasks/rounds`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 上传音频数据进行语音识别，返回Server-Sent Events流式文字结果。响应格式为SSE，每个事件包含event和data字段。
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksSpeechToTextCreate
     * @summary 语音转文字
     * @request POST:/api/v1/users/tasks/speech-to-text
     * @secure
     */
    v1UsersTasksSpeechToTextCreate: (params: RequestParams = {}) =>
      this.request<DomainSpeechRecognitionEvent, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/speech-to-text`,
        method: "POST",
        secure: true,
        ...params,
      }),

    /**
     * @description 通过 WebSocket 上传实时音频流并实时返回识别结果。 后端使用豆包流式语音识别 2.0 (bigmodel_async)。完整协议见 docs/speech-to-text-stream.md。 ## 帧类型约定 | 方向 | 帧类型 | 用途 | |---|---|---| | C → S | Text(JSON) | 控制消息:start / stop | | C → S | Binary | 音频字节流,服务端封装为豆包帧透传 | | S → C | Text(JSON) | 所有事件(ready / partial / final / done / error) | ## 客户端 → 服务端 ### 1) start (第一帧必须是它) ```json { "type": "start", "format": "pcm", "disfluency": false } ``` - `format` 可选,默认 `pcm`。支持 `pcm` / `wav` / `ogg` / `mp3`,单声道、16-bit、采样率固定 16000Hz - `pcm` / `wav` 内部音频流必须是 `pcm_s16le`;`ogg` 必须为 `opus` 编码;`mp3` 由远端解码 - `disfluency` 可选,默认 `false`。`true` 时启用语义顺滑(过滤"嗯/啊"等口头禅、语义重复词) - 服务端校验通过 → 与豆包建立 WSS → 收到首个响应后向客户端下发 `ready` 事件(带 `logid`) - **客户端必须在收到 `ready` 之后才能发 Binary 音频帧** - 以下能力默认开启:中间结果(双向流式天然有)、标点预测、ITN(中文数字转阿拉伯数字) ### 2) Binary 音频帧 `ready` 之后,客户端持续发 Binary 帧。**建议每帧 200ms**(豆包推荐值,过碎会影响性能)。 ### 3) stop (主动结束) ```json { "type": "stop" } ``` 服务端收到后向豆包发送"最后一包"标志,等待豆包最终响应后下发 `done` 事件并关闭 WS。客户端直接 close WS 亦可。 ## 服务端 → 客户端 所有事件统一外层结构: ```json { "type": "<event_type>", "timestamp": 1733299200000, ... } ``` ### ready — 远端已就绪 ```json { "type": "ready", "logid": "202407261553070FACFE6D19421815D605", "timestamp": 1733299200000 } ``` 仅推送一次。客户端收到后开始发 Binary 音频帧。`logid` 是豆包返回的 `X-Tt-Logid`,排障必备, 建议前端在 session 期间一直打印它,跟后续 error 事件可以关联。 ### partial — 中间结果(实时滚动,会反复推送) ```json { "type": "partial", "index": 1, "text": "今天天气真", "timestamp": 1733299201500 } ``` - 同一 `index` 的 `partial` 会反复推送,`text` 通常逐渐变长 - **客户端必须用 `text` 覆盖该句显示内容,不要追加** ### final — 一句话定稿 ```json { "type": "final", "index": 1, "text": "今天天气真不错。", "timestamp": 1733299202800 } ``` - 该句识别完成、内容固化,后续不会再变;客户端用 `text` 覆盖 `index` 对应位置 - `final` 之后可能立刻有下一句的 `partial`(`index+1`) ### done — 整个 session 结束 ```json { "type": "done", "logid": "...", "timestamp": 1733299210000 } ``` - 服务端已收到豆包最后一包响应、释放资源,即将关闭 WS;`done` 之后不会再有任何事件 ### error — 错误 豆包远端错误: ```json { "type": "error", "logid": "202407261553070FACFE6D19421815D605", "error": { "code": 45000001, "message": "请求参数无效", "request_id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3", "logid": "202407261553070FACFE6D19421815D605" }, "timestamp": 1733299205000 } ``` 本服务前置校验错误(远端连接前):`code=0`,在 `message` 描述原因: ```json { "type": "error", "error": { "code": 0, "message": "first message must be a 'start' control message" }, "timestamp": 1733299205000 } ``` ## 豆包常见错误码速查 | code | 含义 | 典型原因 | |---|---|---| | `45000001` | 请求参数无效 | 缺字段 / 字段值无效 / 重复请求 | | `45000002` | 空音频 | 录音未采集到声音 | | `45000081` | 等包超时 | 前端没在期限内连续发送音频帧 | | `45000151` | 音频格式不正确 | `format` 与实际音频不匹配 | | `55000031` | 服务器繁忙 | 退避重试 | | `550xxxxx` | 服务内部错误 | 直接重试,持续失败时带 `logid` 联系运维 | ## 时序示例 ``` C → S: WS upgrade (带鉴权) C → S: {"type":"start","format":"pcm"} S → C: {"type":"ready","logid":"..."} C → S: <binary 200ms> <binary 200ms> ... S → C: {"type":"partial","index":1,"text":"今天"} S → C: {"type":"partial","index":1,"text":"今天天气真"} S → C: {"type":"final","index":1,"text":"今天天气真不错。"} C → S: {"type":"stop"} S → C: {"type":"done","logid":"..."} WS close ``` ## 与 POST /speech-to-text 的差异 - POST /speech-to-text:整段录音 → SSE 单段结果,适合短语音 ≤60s - 本接口:WS 双向实时流,支持长语音、句级 final、可被打断,适合 Web/移动端边说边显示
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksSpeechToTextStreamList
     * @summary 实时语音转写(WebSocket 流式)
     * @request GET:/api/v1/users/tasks/speech-to-text-stream
     * @secure
     */
    v1UsersTasksSpeechToTextStreamList: (
      start: GithubComChaitinMonkeyCodeBackendDomainSpeechStreamStartReq,
      params: RequestParams = {},
    ) =>
      this.request<any, GithubComChaitinMonkeyCodeBackendDomainSpeechStreamEvent | GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/speech-to-text-stream`,
        method: "GET",
        body: start,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description 停止任务
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksStopUpdate
     * @summary 停止任务
     * @request PUT:/api/v1/users/tasks/stop
     * @secure
     */
    v1UsersTasksStopUpdate: (
      id: GithubComChaitinMonkeyCodeBackendDomainIDReqGithubComGoogleUuidUUID,
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, any>({
        path: `/api/v1/users/tasks/stop`,
        method: "PUT",
        body: id,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 功能定位：该接口通过 WebSocket 转发任务运行数据。任务对话继续输入使用 `type=user-input`。 数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 domain.TaskStream）： ```json { "type": "string", "data": "string", "kind": "string", "timestamp": 0 } ``` user-input 上行新格式： ```json { "type": "user-input", "data": "{\"content\":\"57un57ut5aSE55CG6L+Z5Liq6Zeu6aKY\",\"attachments\":[{\"url\":\"https://example-bucket.oss-cn-hangzhou.aliyuncs.com/temp/a.txt\",\"filename\":\"a.txt\"}]}" } ``` user-input 上行旧格式仍兼容： ```json { "type": "user-input", "data": "继续处理这个问题" } ``` user-input 下行和历史返回统一使用新 JSON payload 字符串： ```json { "type": "user-input", "data": "{\"content\":\"57un57ut5aSE55CG6L+Z5Liq6Zeu6aKY\",\"attachments\":[]}", "timestamp": 0 } ``` `attachments` 为可选附件列表，最多 10 个；每项包含 `url` 和 `filename`，URL 需要匹配后端配置的附件白名单前缀。 type 字段说明： - task-started: 本轮任务启动 - task-ended: 本轮任务结束 - task-error: 本轮任务发生错误 - task-running: 任务正在运行 - task-event: 任务临时事件, 不持久化 - file-change: 文件变动事件 - permission-resp: 用户的权限响应 - auto-approve: 开启自动批准 - disable-auto-approve: 关闭自动批准 - user-input: 用户输入 - user-cancel: 取消当前操作，不会终止任务 - reply-question: 回复 AI 的提问 - cursor: 历史游标，用于通过 /rounds 接口加载更早的轮次 cursor 消息结构： ```json { "type": "cursor", "data": { "cursor": "<nextCursor>", "has_more": true }, "timestamp": 0 } ``` - cursor: 当前分页游标，作为 GET /rounds 接口的 cursor 参数向前翻页 - has_more: 是否存在更早的轮次。为 false 时表示当前轮次即为第一轮，无需再翻页
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksStreamList
     * @summary 任务数据流 WebSocket
     * @request GET:/api/v1/users/tasks/stream
     * @secure
     */
    v1UsersTasksStreamList: (
      query: {
        /** 任务 ID */
        id: string;
        /** 模式：new(等待用户输入)|attach(仅拉取当前轮次)，默认 new */
        mode?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/stream`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 查询任务的 user-input 消息（倒序，最新在前），根据 cursor 向更早翻页，用于聊天页侧边栏快速跳转到指定一轮对话。 单条返回的 id 形如 `user-input-{timestamp_ns}`，与前端聊天页消息列表中的 `data-message-id` 对齐。 content 已解码为明文，超出 500 字符会截断并将 truncated 置为 true。 日志存储为 ClickHouse 时每条带 seq（轮次号），可作为 /rounds 接口的 cursor 配合 inclusive=true 跳转定位；Loki 下无 seq。
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksUserInputsList
     * @summary 查询任务用户输入列表
     * @request GET:/api/v1/users/tasks/user-inputs
     * @secure
     */
    v1UsersTasksUserInputsList: (
      query: {
        /** 任务 ID */
        id: string;
        /** 分页游标，第一页留空 */
        cursor?: string;
        /** 返回条数（默认 20，上限 100） */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainTaskUserInputsResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/tasks/user-inputs`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 任务详情
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksDetail
     * @summary 任务详情
     * @request GET:/api/v1/users/tasks/{id}
     * @secure
     */
    v1UsersTasksDetail: (id: string, params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: DomainTask;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/tasks/${id}`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 更新任务信息（如标题）
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksUpdate
     * @summary 更新任务
     * @request PUT:/api/v1/users/tasks/{id}
     * @secure
     */
    v1UsersTasksUpdate: (
      id: string,
      param: GithubComChaitinMonkeyCodeBackendDomainUpdateTaskReq,
      params: RequestParams = {},
    ) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/${id}`,
        method: "PUT",
        body: param,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 删除任务。任务处于运行中（pending/processing）或虚拟机仍在线时不允许删除。
     *
     * @tags 【用户】任务管理
     * @name V1UsersTasksDelete
     * @summary 删除任务
     * @request DELETE:/api/v1/users/tasks/{id}
     * @secure
     */
    v1UsersTasksDelete: (id: string, params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/tasks/${id}`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 用户钱包
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletList
     * @summary 用户钱包
     * @request GET:/api/v1/users/wallet
     * @secure
     */
    v1UsersWalletList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainWallet;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/wallet`,
        method: "GET",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 查询当天是否已签到
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletCheckinList
     * @summary 查询签到状态
     * @request GET:/api/v1/users/wallet/checkin
     * @secure
     */
    v1UsersWalletCheckinList: (params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainCheckInResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/wallet/checkin`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description 每日签到领取积分奖励，每天只能签到一次
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletCheckinCreate
     * @summary 每日签到
     * @request POST:/api/v1/users/wallet/checkin
     * @secure
     */
    v1UsersWalletCheckinCreate: (req: DomainCheckInReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainCheckInResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/wallet/checkin`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 兑现兑换码
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletExchangeCreate
     * @summary 兑现兑换码
     * @request POST:/api/v1/users/wallet/exchange
     * @secure
     */
    v1UsersWalletExchangeCreate: (req: DomainExchangeReq, params: RequestParams = {}) =>
      this.request<GitInChaitinNetGoDevWebResp, GitInChaitinNetGoDevWebResp>({
        path: `/api/v1/users/wallet/exchange`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 会员订阅 / 积分充值
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletRechargeCreate
     * @summary 会员订阅 / 积分充值
     * @request POST:/api/v1/users/wallet/recharge
     * @secure
     */
    v1UsersWalletRechargeCreate: (req: DomainRechargeReq, params: RequestParams = {}) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainRechargeResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/wallet/recharge`,
        method: "POST",
        body: req,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 交易记录
     *
     * @tags 【用户】钱包
     * @name V1UsersWalletTransactionList
     * @summary 交易记录
     * @request GET:/api/v1/users/wallet/transaction
     * @secure
     */
    v1UsersWalletTransactionList: (
      query?: {
        /** 结束时间戳 */
        end?: number;
        /** 下一页标识 */
        next_token?: string;
        /** 分页 */
        page?: number;
        /** 每页多少条记录 */
        size?: number;
        /** 根据 created_at 排序A；asc/desc；默认为 desc */
        sort?: string;
        /** 开始时间戳 */
        start?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<
        GitInChaitinNetGoDevWebResp & {
          data?: DomainListTransactionResp;
        },
        GitInChaitinNetGoDevWebResp
      >({
        path: `/api/v1/users/wallet/transaction`,
        method: "GET",
        query: query,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 解除当前用户与微信公众号 OpenID 的绑定关系
     *
     * @tags 【用户】微信公众号推送
     * @name V1UsersWechatMpBindDelete
     * @summary 解除公众号绑定
     * @request DELETE:/api/v1/users/wechat-mp/bind
     * @secure
     */
    v1UsersWechatMpBindDelete: (params: RequestParams = {}) =>
      this.request<GithubComGoYokoWebResp, GithubComGoYokoWebResp>({
        path: `/api/v1/users/wechat-mp/bind`,
        method: "DELETE",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description 为当前登录用户创建微信公众号绑定临时二维码，用户扫码关注/扫码后完成绑定
     *
     * @tags 【用户】微信公众号推送
     * @name V1UsersWechatMpBindQrcodeCreate
     * @summary 创建公众号绑定二维码
     * @request POST:/api/v1/users/wechat-mp/bind-qrcode
     * @secure
     */
    v1UsersWechatMpBindQrcodeCreate: (params: RequestParams = {}) =>
      this.request<
        GithubComGoYokoWebResp & {
          data?: GithubComChaitinMonkeyCodeBackendDomainBindQRCodeResp;
        },
        GithubComGoYokoWebResp
      >({
        path: `/api/v1/users/wechat-mp/bind-qrcode`,
        method: "POST",
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
}
