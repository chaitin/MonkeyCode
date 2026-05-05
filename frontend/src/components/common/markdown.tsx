import { memo, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import mermaid from "mermaid"
import { Link, useLocation } from "react-router-dom"
import { IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import "@/utils/markdown.css"
import { cn } from "@/lib/utils"

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

const Mermaid = memo(function Mermaid({ chart }: MermaidProps) {
  const [svg, setSvg] = useState<string>("")
  const [hasError, setHasError] = useState(false)
  const renderVersionRef = useRef(0)

  useEffect(() => {
    const currentRenderVersion = ++renderVersionRef.current

    const renderChart = async () => {
      try {
        // 使用唯一 ID 避免冲突
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
        const { svg } = await mermaid.render(id, chart)
        if (renderVersionRef.current !== currentRenderVersion) return
        setSvg(svg)
        setHasError(false)
      } catch (err) {
        if (renderVersionRef.current !== currentRenderVersion) return
        console.error("Mermaid render error:", err)
        setSvg("")
        setHasError(true)
      }
    }

    renderChart()
  }, [chart])

  if (hasError) {
    return (
      <CodeBlock code={chart} language="mermaid" />
    )
  }

  return (
    <div 
      className="mermaid-container flex justify-center my-4"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  )
})

const MarkdownParagraph: NonNullable<Components["p"]> = ({ children, ...props }) => {
  if (typeof children === "string") {
    return (children as string).split("\n").map((line: string, index: number) => (
      <p key={index} {...props}>{line}</p>
    ))
  }

  return <p {...props}>{children}</p>
}

interface CodeBlockProps {
  code: string
  language: string
}

const CodeBlock = ({ code, language }: CodeBlockProps) => {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success("代码已复制到剪贴板")
    } catch (error) {
      toast.error("复制代码失败")
      console.error("复制代码失败:", error)
    }
  }

  return (
    <div className="group/code relative">
      <button
        type="button"
        className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md border bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover/code:opacity-100"
        onClick={handleCopy}
        aria-label="复制代码"
      >
        <IconCopy className="size-4" />
      </button>
      <SyntaxHighlighter
        language={language}
        PreTag="pre"
        wrapLines={true}
        customStyle={{ textShadow: "none" }}
        codeTagProps={{ style: { wordBreak: "break-all", whiteSpace: "pre-wrap", textShadow: "none" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

const MarkdownCodeBlock: NonNullable<Components["pre"]> = ({ children }) => {
  const childElement = children as React.ReactElement | undefined
  const props = childElement?.props as { children?: string; className?: string } | undefined
  const code = props?.children ?? ""
  const language = props?.className?.replace("language-", "").trim() || "text"

  if (language === "mermaid") {
    return <Mermaid chart={String(code).trim()} />
  }

  return <CodeBlock code={String(code)} language={language} />
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

export const Markdown = memo(function Markdown({ children, allowHtml = false, allowInternalLink = true, className }: MarkdownProps) {
  const location = useLocation()
  const markdownSource = typeof children === "string" ? children : ""
  const components = useMemo<Components>(() => ({
    a({ href, children, ...props }) {
      if (isInternalLink(href)) {
        const absolutePath = resolveRelativePath(href as string, location.pathname)
        return <Link to={allowInternalLink ? absolutePath : ""} {...props}>{children}</Link>
      }

      return (
        <a href={href} target="_blank" {...props}>
          {children}
        </a>
      )
    },
    p: MarkdownParagraph,
    pre: MarkdownCodeBlock,
  }), [allowInternalLink, location.pathname])

  return (
    <div className={cn("markdown-body pb-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw, rehypeSanitize] : []}
        components={components}
      >
        {markdownSource}
      </ReactMarkdown>
    </div>
  )
})
