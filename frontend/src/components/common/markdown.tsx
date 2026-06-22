import { memo, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"
import mermaid from "mermaid"
import { Link, useLocation } from "react-router-dom"
import { IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import "@/utils/markdown.css"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-context"
import { useTranslation } from "react-i18next"

// Initialize Mermaid configuration.
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  suppressErrorRendering: true,
})

interface MermaidProps {
  chart: string
  isDark: boolean
}

const Mermaid = memo(function Mermaid({ chart, isDark }: MermaidProps) {
  const [svg, setSvg] = useState<string>("")
  const [hasError, setHasError] = useState(false)
  const renderVersionRef = useRef(0)

  useEffect(() => {
    const currentRenderVersion = ++renderVersionRef.current

    const renderChart = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
          suppressErrorRendering: true,
        })
        // Use a unique ID to avoid collisions.
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
  }, [chart, isDark])

  if (hasError) {
    return (
      <CodeBlock code={chart} language="mermaid" isDark={isDark} />
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
  isDark: boolean
}

const CodeBlock = ({ code, language, isDark }: CodeBlockProps) => {
  const { t } = useTranslation()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t("common.markdown.copySuccess"))
    } catch (error) {
      toast.error(t("common.markdown.copyFailed"))
      console.error("Copy code failed:", error)
    }
  }

  return (
    <div className="group/code relative">
      <button
        type="button"
        className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md border bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover/code:opacity-100"
        onClick={handleCopy}
        aria-label={t("common.markdown.copyCode")}
      >
        <IconCopy className="size-4" />
      </button>
      <SyntaxHighlighter
        language={language}
        PreTag="pre"
        wrapLines={true}
        style={isDark ? oneDark : oneLight}
        customStyle={{ textShadow: "none", background: "var(--muted)" }}
        codeTagProps={{ style: { wordBreak: "break-all", whiteSpace: "pre-wrap", textShadow: "none" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function MarkdownCodeBlock({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const childElement = children as React.ReactElement | undefined
  const props = childElement?.props as { children?: string; className?: string } | undefined
  const code = props?.children ?? ""
  const language = props?.className?.replace("language-", "").trim() || "text"

  if (language === "mermaid") {
    return <Mermaid chart={String(code).trim()} isDark={isDark} />
  }

  return <CodeBlock code={String(code)} language={language} isDark={isDark} />
}

interface MarkdownProps {
  children: string
  /** Whether raw HTML rendering is allowed. Content is still sanitized. */
  allowHtml?: boolean
  /** Whether internal links should navigate in-app. */
  allowInternalLink?: boolean
  className?: string
}

/**
 * Determine whether the link points inside the current site.
 * Internal links include relative paths, absolute paths starting with /, and same-origin full URLs.
 */
function isInternalLink(href: string | undefined): boolean {
  if (!href) return false
  
  try {
    const url = new URL(href, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    // Treat parse failures as internal links.
    return true
  }
}

/**
 * Resolve a relative path to an absolute path.
 * @param href Original link.
 * @param currentPath Current page path.
 */
function resolveRelativePath(href: string, currentPath: string): string {
  // Already absolute.
  if (href.startsWith('/')) {
    return href
  }
  
  // Resolve relative to the current directory.
  const basePath = currentPath.endsWith('/') 
    ? currentPath.slice(0, -1) 
    : currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
  
  try {
    const resolved = new URL(href, `http://dummy${basePath}/`).pathname
    return resolved
  } catch {
    // Preserve the original href if URL parsing fails.
    return href
  }
}

export const Markdown = memo(function Markdown({ children, allowHtml = false, allowInternalLink = true, className }: MarkdownProps) {
  const location = useLocation()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
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
    pre: ({ children }) => <MarkdownCodeBlock isDark={isDark}>{children}</MarkdownCodeBlock>,
  }), [allowInternalLink, isDark, location.pathname])

  return (
    <div className={cn("markdown-body pb-2", isDark ? "markdown-body-dark" : "markdown-body-light", className)}>
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
