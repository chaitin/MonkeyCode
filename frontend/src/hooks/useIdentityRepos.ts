import { useCallback, useEffect, useRef, useState } from "react"

import type { DomainAuthRepository } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"

const DEFAULT_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

interface UseIdentityReposOptions {
  /** 仅当为 true 时才发起请求（如弹窗打开且已选中身份） */
  enabled?: boolean
  pageSize?: number
}

/**
 * useIdentityRepos 负责按 page/size/keyword 分页拉取某个 Git 身份下的仓库列表。
 * - keyword 走后端服务端过滤（防抖），改变 keyword 会重置回第 1 页；
 * - loadMore() 在 hasNext 时追加下一页；
 * - 仓库列表的展示/映射由调用方负责（这里只吐原始 DomainAuthRepository）。
 */
export function useIdentityRepos(
  identityId: string | undefined,
  { enabled = true, pageSize = DEFAULT_PAGE_SIZE }: UseIdentityReposOptions = {}
) {
  const [repos, setRepos] = useState<DomainAuthRepository[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState("")
  const [debouncedKeyword, setDebouncedKeyword] = useState("")

  const pageRef = useRef(1)
  // 单调递增的请求序号，丢弃过期（乱序返回）的响应，避免快速输入/翻页时结果错乱
  const reqIdRef = useRef(0)

  // keyword 防抖
  useEffect(() => {
    const id = setTimeout(() => setDebouncedKeyword(keyword.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [keyword])

  const fetchPage = useCallback(
    (page: number, kw: string, append: boolean, flush = false) => {
      if (!identityId) return
      const reqId = ++reqIdRef.current
      if (append) setLoadingMore(true)
      else setLoading(true)

      apiRequest(
        "v1UsersGitIdentitiesDetail",
        { page, size: pageSize, keyword: kw || undefined, ...(flush ? { flush: true } : {}) },
        [identityId],
        (resp) => {
          if (reqId !== reqIdRef.current) return // 过期响应，丢弃
          if (resp.code !== 0) {
            setLoading(false)
            setLoadingMore(false)
            return
          }
          const list: DomainAuthRepository[] = (resp.data?.authorized_repositories || []).filter(
            (r: DomainAuthRepository) => r.url?.trim()
          )
          const pageInfo = resp.data?.repo_page_info
          setRepos((prev) => (append ? [...prev, ...list] : list))
          setHasNext(Boolean(pageInfo?.has_next_page))
          setTotal(pageInfo?.total_count ?? list.length)
          pageRef.current = page
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
    [identityId, pageSize]
  )

  // 身份 / 关键字 / enabled 变化时，重置并拉第 1 页
  useEffect(() => {
    if (!enabled || !identityId) {
      reqIdRef.current++ // 使在途请求作废
      setRepos([])
      setHasNext(false)
      setTotal(0)
      pageRef.current = 1
      return
    }
    fetchPage(1, debouncedKeyword, false)
  }, [enabled, identityId, debouncedKeyword, fetchPage])

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasNext) return
    fetchPage(pageRef.current + 1, debouncedKeyword, true)
  }, [loading, loadingMore, hasNext, debouncedKeyword, fetchPage])

  // reload 重新从第 1 页拉取（flush=true 时强制刷新后端缓存）
  const reload = useCallback(
    (flush = false) => {
      fetchPage(1, debouncedKeyword, false, flush)
    },
    [debouncedKeyword, fetchPage]
  )

  return {
    repos,
    loading,
    loadingMore,
    hasNext,
    total,
    keyword,
    setKeyword,
    loadMore,
    reload,
  }
}
