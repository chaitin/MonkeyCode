import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface GitHubSetupResult {
  type: 'success' | 'error'
  accountLogin?: string
  reason?: string
  message?: string
}

export function useGitHubSetupCallback(onSuccess?: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [result, setResult] = useState<GitHubSetupResult | null>(null)
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    const githubSetup = searchParams.get('github_setup')
    if (!githubSetup) return

    processed.current = true

    if (githubSetup === 'success') {
      setResult({
        type: 'success',
        accountLogin: searchParams.get('account_login') || undefined,
      })
      onSuccess?.()
    } else if (githubSetup === 'error') {
      setResult({
        type: 'error',
        reason: searchParams.get('reason') || 'unknown',
        message: searchParams.get('message') || '未知错误',
      })
    }

    // 清理 URL 参数
    const newParams = new URLSearchParams(searchParams)
    newParams.delete('github_setup')
    newParams.delete('installation_id')
    newParams.delete('account_login')
    newParams.delete('reason')
    newParams.delete('message')
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams, onSuccess])

  const dismiss = () => setResult(null)

  return { result, dismiss }
}
