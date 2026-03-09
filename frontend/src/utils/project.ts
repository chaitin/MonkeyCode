import { type DomainProject } from "@/api/Api"

export const EMPTY_GIT_IDENTITY_ID = "00000000-0000-0000-0000-000000000000"

export function isProjectRepoUnbound(project?: DomainProject): boolean {
  if (!project) {
    return false
  }

  const platform = project.platform?.trim() || ""
  const gitIdentityId = project.git_identity_id?.trim() || ""
  const repoUrl = project.repo_url?.trim() || ""
  const isGitIdentityEmpty = repoUrl === "" && (gitIdentityId === "" || gitIdentityId === EMPTY_GIT_IDENTITY_ID)

  return platform === "" && isGitIdentityEmpty
}
