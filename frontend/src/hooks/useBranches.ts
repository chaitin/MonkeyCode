import { useCallback, useEffect, useRef, useState } from "react"

import type { DomainBranch } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"

const DEFAULT_PAGE_SIZE = 50

interface UseBranchesOptions {
  enabled?: boolean
  pageSize?: number
}

/**
 * useBranches 按 page/per_page 分页拉取某个 Git 身份下指定仓库的分支列表。
 * - loadMore() 在 hasMore 时追加下一页；
 * - enabled / gitIdentityId / repoFullName 变化时重置回第 1 页；
 * - 默认分支选择逻辑由调用方负责。
 */
export function useBranches(
  gitIdentityId: string | undefined,
  repoFullName: string | undefined,
  { enabled = true, pageSize = DEFAULT_PAGE_SIZE }: UseBranchesOptions = {}
) {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const pageRef = useRef(1)
  const reqIdRef = useRef(0)

  const fetchPage = useCallback(
    (page: number, append: boolean) => {
      if (!gitIdentityId || !repoFullName) return

      const encodedRepoName = encodeURIComponent(repoFullName)
      const reqId = ++reqIdRef.current

      if (append) setLoadingMore(true)
      else setLoading(true)

      apiRequest(
        "v1UsersGitIdentitiesBranchesDetail",
        { page, per_page: pageSize },
        [gitIdentityId, encodedRepoName],
        (resp) => {
          if (reqId !== reqIdRef.current) return
          if (resp.code === 0 && resp.data) {
            const list = (resp.data as DomainBranch[])
              .map((b) => b.name || "")
              .filter(Boolean)
            setBranches((prev) => (append ? [...prev, ...list] : list))
            setHasMore(list.length >= pageSize)
            pageRef.current = page
          }
          setLoading(false)
          setLoadingMore(false)
        },
        () => {
          if (reqId !== reqIdRef.current) return
          setLoading(false)
          setLoadingMore(false)
        }
      )
    },
    [gitIdentityId, repoFullName, pageSize]
  )

  useEffect(() => {
    if (!enabled || !gitIdentityId || !repoFullName) {
      reqIdRef.current++
      setBranches([])
      setHasMore(false)
      pageRef.current = 1
      setLoading(false)
      setLoadingMore(false)
      return
    }
    fetchPage(1, false)
  }, [enabled, gitIdentityId, repoFullName, fetchPage])

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    fetchPage(pageRef.current + 1, true)
  }, [loading, loadingMore, hasMore, fetchPage])

  const reset = useCallback(() => {
    reqIdRef.current++
    setBranches([])
    setHasMore(false)
    pageRef.current = 1
    if (enabled && gitIdentityId && repoFullName) {
      fetchPage(1, false)
    }
  }, [enabled, gitIdentityId, repoFullName, fetchPage])

  return {
    branches,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    reset,
  }
}
