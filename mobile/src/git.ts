/**
 * Git 平台元数据 —— 对齐 Web 端 add-identity.tsx 的平台列表与默认地址，
 * 以及 utils/common.tsx 的 GitHub App 安装地址逻辑。
 */
import { getBaseUrl } from '@/api/client';
import type { GitPlatform } from '@/api/types';

export interface GitPlatformDef {
  key: GitPlatform;
  label: string;
  /** 选中平台后自动填入的默认 Base URL（用户仍可改为自建实例地址） */
  defaultBaseUrl: string;
  /** 是否支持 OAuth 一键授权（其余平台只能手动填 Access Token） */
  oauth: boolean;
}

// 顺序与 Web 平台下拉一致。GitCode 在后端对应 atomgit。
export const GIT_PLATFORMS: GitPlatformDef[] = [
  { key: 'github', label: 'GitHub', defaultBaseUrl: 'https://github.com', oauth: true },
  { key: 'gitlab', label: 'GitLab', defaultBaseUrl: 'https://gitlab.com', oauth: true },
  { key: 'gitee', label: 'Gitee', defaultBaseUrl: 'https://gitee.com', oauth: true },
  { key: 'gitea', label: 'Gitea', defaultBaseUrl: 'https://gitea.com', oauth: true },
  { key: 'codeup', label: 'Codeup', defaultBaseUrl: 'https://openapi-rdc.aliyuncs.com', oauth: false },
  { key: 'cnb', label: 'CNB', defaultBaseUrl: 'https://api.cnb.cool', oauth: false },
  { key: 'atomgit', label: 'GitCode', defaultBaseUrl: 'https://api.atomgit.com', oauth: false },
];

/** 支持 OAuth 一键授权的平台（添加身份时的「一键授权」入口） */
export const OAUTH_PLATFORMS = GIT_PLATFORMS.filter((p) => p.oauth);

export function gitPlatformDef(platform?: string): GitPlatformDef | undefined {
  return GIT_PLATFORMS.find((p) => p.key === platform);
}

export function gitPlatformLabel(platform?: string): string {
  return gitPlatformDef(platform)?.label ?? (platform || '未知平台');
}

/** GitLab OAuth 授权需要指定实例 base，默认公有云。 */
export const GITLAB_DEFAULT_BASE = 'https://gitlab.com';

/**
 * GitHub App 安装地址：生产环境用 monkeycode-ai，其它环境用开发 App（对齐 Web getGithubAppInstallUrl）。
 * 安装完成后 GitHub 会回跳后端 setup 回调，再重定向回站点，WebView 据此判定完成。
 */
export function githubAppInstallUrl(): string {
  return getBaseUrl() === 'https://monkeycode-ai.com'
    ? 'https://github.com/apps/monkeycode-ai/installations/new'
    : 'https://github.com/apps/mcai-dev-nb/installations/new';
}
