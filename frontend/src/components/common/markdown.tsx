import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import mermaid from "mermaid"
import { Link, useLocation } from "react-router-dom"
import "@/utils/markdown.css"
import { cn } from "@/lib/utils"

// 动态导入 gray-matter 和 Buffer
let matter: any = null
let Buffer: any = null

async function initGrayMatter() {
  if (matter && Buffer) return
  
  try {
    const [{ default: matterModule }, { Buffer: BufferModule }] = await Promise.all([
      import("gray-matter"),
      import("buffer")
    ])
    matter = matterModule
    Buffer = BufferModule
    
    // 设置全局 Buffer
    if (typeof window !== 'undefined') {
      (window as any).Buffer = Buffer
    }
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).Buffer = Buffer
    }
  } catch (err) {
    console.error("Failed to load gray-matter:", err)
  }
}

// 初始化 mermaid 配置
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  suppressErrorRendering: true,
})

interface MermaidProps {
  chart: string
}

function Mermaid({ chart }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current) return
      
      try {
        // 使用唯一 ID 避免冲突
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
        const { svg } = await mermaid.render(id, chart)
        setSvg(svg)
        setError(null)
      } catch (err) {
        console.error("Mermaid render error:", err)
        setError(err instanceof Error ? err.message : "Failed to render diagram")
      }
    }

    renderChart()
  }, [chart])

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-700">
        <p className="font-semibold">Mermaid 渲染错误</p>
        <pre className="text-sm mt-2 whitespace-pre-wrap">{error}</pre>
        <pre className="text-sm mt-2 p-2 bg-red-100 rounded overflow-x-auto">{chart}</pre>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef} 
      className="mermaid-container flex justify-center my-4"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  )
}

interface MarkdownProps {
  children: string
  /** 是否允许渲染原始 HTML（会自动进行安全处理） */
  allowHtml?: boolean
  /** 是否允许渲染站内链接 */
  allowInternalLink?: boolean
  className?: string
}

/**
 * 判断是否为站内链接
 * 站内链接包括：相对路径、以 / 开头的绝对路径、同域名的完整 URL
 */
function isInternalLink(href: string | undefined): boolean {
  if (!href) return false
  
  try {
    const url = new URL(href, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    // 如果解析失败，当作站内链接处理
    return true
  }
}

/**
 * 将相对路径解析为绝对路径
 * @param href 原始链接
 * @param currentPath 当前页面路径
 */
function resolveRelativePath(href: string, currentPath: string): string {
  // 如果已经是绝对路径，直接返回
  if (href.startsWith('/')) {
    return href
  }
  
  // 处理相对路径
  // 获取当前路径的目录部分（去掉最后的文件名/路由段）
  const basePath = currentPath.endsWith('/') 
    ? currentPath.slice(0, -1) 
    : currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
  
  // 使用 URL API 解析相对路径
  try {
    const resolved = new URL(href, `http://dummy${basePath}/`).pathname
    return resolved
  } catch {
    // 解析失败时返回原始 href
    return href
  }
}

export function Markdown({ children, allowHtml = false, allowInternalLink = true, className }: MarkdownProps) {
  const location = useLocation()
  const [frontMatter, setFrontMatter] = useState<Record<string, any>>({})
  const [content, setContent] = useState<string>(children)
  
  // 初始化并解析 front matter
  useEffect(() => {
    let mounted = true
    setFrontMatter({})
    setContent(children)
    
    async function parseFrontMatter() {
      await initGrayMatter()
      if (!mounted || !matter) {
        return
      }
      
      try {
        const result = matter(children)
        if (mounted) {
          setFrontMatter(result.data || {})
          setContent(result.content)
        }
      } catch (err) {
        console.error("Failed to parse front matter:", err)
        if (mounted) {
          setContent(children)
        }
      }
    }
    
    parseFrontMatter()
    
    return () => {
      mounted = false
    }
  }, [children])
  
  const hasFrontMatter = Object.keys(frontMatter).length > 0

  return (
    <div className={cn("markdown-body pb-2", className)}>
      {/* 渲染 front matter */}
      {hasFrontMatter && (
        <div className="overflow-x-auto mb-4 border-b">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(frontMatter).map(([key, value]) => (
                <tr key={key} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-4 font-medium text-muted-foreground align-top w-32">
                    {key}
                  </td>
                  <td className="py-2 break-words">
                    {typeof value === 'object' && value !== null ? (
                      <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      <span>{String(value)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* 渲染 markdown 内容 */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw, rehypeSanitize] : []}
        components={{
          a({ href, children, ...props }) {
            if (isInternalLink(href)) {
              const absolutePath = resolveRelativePath(href as string, location.pathname)
              return <Link to={allowInternalLink ? absolutePath : ""} {...props}>{children}</Link>
            } else {
              return (
                <a href={href} target="_blank" {...props}>
                  {children}
                </a>
              )
            }
          },
          p({children, ...props}) {
            if (typeof children === 'string') {
              return (children as string).split('\n').map((line: string, index: number) => (
                <p key={index} {...props}>{line}</p>
              ))
            } else {
              return <p {...props}>{children}</p>
            }
          },
          pre({children}) {
            const childElement = children as React.ReactElement | undefined
            const props = childElement?.props as { children?: string; className?: string } | undefined
            const code = props?.children ?? ''
            const language = props?.className?.replace('language-', '').trim() || 'text'
            
            // 检测是否是 mermaid 代码块
            if (language === 'mermaid') {
              return <Mermaid chart={String(code).trim()} />
            }
            
            return (
              <SyntaxHighlighter
                language={language}
                PreTag="pre"
                wrapLines={true}
                codeTagProps={{ style: { wordBreak: 'break-all', whiteSpace: 'pre-wrap' } }}
              >
                {code}
              </SyntaxHighlighter>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
