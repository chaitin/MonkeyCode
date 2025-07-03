// import { ToolInfo } from '@/api';
import { Icon, message } from '@c-x/ui';
import { Box, Button, IconButton, Stack, useTheme, alpha } from '@mui/material';
import React, { useState, useRef } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import SyntaxHighlighter from 'react-syntax-highlighter';
import {
  github,
  anOldHope,
} from 'react-syntax-highlighter/dist/esm/styles/hljs';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import Diff from './diff';
import { visit } from 'unist-util-visit';

interface ExtendedComponents extends Components {
  tools?: React.ComponentType<any>;
}

export const toolNames = [
  'execute_command',
  'read_file',
  'write_to_file',
  'apply_diff',
  'insert_content',
  'search_and_replace',
  'search_files',
  'list_files',
  'list_code_definition_names',
  'browser_action',
  'use_mcp_tool',
  'access_mcp_resource',
  'ask_followup_question',
  'attempt_completion',
  'switch_mode',
  'new_task',
  'fetch_instructions',
];

// 去掉下划线的标签名，用于Markdown渲染
export const toolTagNames = toolNames.map((name) => name.replace(/_/g, ''));

type ToolInfo = any;

// 预处理 markdown，提取所有 <diff> 内容，生成 diffMap
function preprocessMarkdown(mdContent: string) {
  let diffIndex = 0;
  const diffMap: Record<string, string> = {};
  const newMd = mdContent.replace(
    /<diff>([\s\S]*?)<\/diff>/g,
    (_, diffContent) => {
      const id = `diff-${diffIndex++}`;
      diffMap[id] = diffContent;
      return `<diff id="${id}"></diff>`;
    }
  );
  return { newMd, diffMap };
}

const MarkDown = ({
  loading = false,
  content,
  showToolInfo = {},
  setShowToolInfo,
  setCurrentToolId,
  handleSearchAbort,
}: {
  loading?: boolean;
  content: string;
  showToolInfo: Record<string, ToolInfo>;
  setShowToolInfo: (value: Record<string, ToolInfo>) => void;
  setCurrentToolId?: (value: string) => void;
  handleSearchAbort?: () => void;
}) => {
  const theme = useTheme();
  const [diffContent, setDiffContent] = useState([]);
  const [showThink, setShowThink] = useState(false);
  const editorRef = useRef<any>(null);

  // 删除 content 中 <thinking> 和 <execute_command> 标签，并保留标签中的内容
  const deleteTags = (content: string) => {
    return content
      .replace(/<\/?thinking>/g, '')
      .replace(/<\/?execute_command>/g, '')
      .replace(/<\/?result>/g, '');
  };

  // 将content中的下划线标签替换为无下划线版本
  const processContent = (content: string) => {
    let processedContent = deleteTags(content);

    // 处理 <file_content> 标签（支持带属性），将其内容替换为 markdown 代码块
    processedContent = processedContent.replace(
      /<file_content(?:\s+[^>]*)?>([\s\S]*?)<\/file_content>/g,
      (match, p1) => {
        // 提取 path 属性
        const pathMatch = match.match(/path\s*=\s*["']([^"']+)["']/);
        let lang = '';
        if (pathMatch) {
          const fileName = pathMatch[1];
          const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
          if (extMatch) {
            lang = extMatch[1];
          }
        }
        // 去除首尾空行
        let code = p1.replace(/^\n+|\n+$/g, '');
        // 去除每行前面的行号
        code = code.replace(/^\s*\d+\s*\|\s?/gm, '');
        // 拼接 markdown 代码块
        return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      }
    );

    toolNames.forEach((toolName) => {
      const withUnderscore = toolName;
      const withoutUnderscore = toolName.replace(/_/g, '');

      // 替换开始标签
      const openTagPattern = new RegExp(`<${withUnderscore}>`, 'g');
      processedContent = processedContent.replace(
        openTagPattern,
        `<${withoutUnderscore}>`
      );

      // 替换结束标签
      const closeTagPattern = new RegExp(`</${withUnderscore}>`, 'g');
      processedContent = processedContent.replace(
        closeTagPattern,
        `</${withoutUnderscore}>`
      );
    });

    return processedContent;
  };

  // 预处理 markdown，提取 diffMap
  const { newMd, diffMap } = preprocessMarkdown(content);
  const answer = processContent(newMd);

  if (content.length === 0) return null;

  return (
    <Box
      className='markdown-body'
      id='markdown-body'
      sx={{
        fontSize: '14px',
        background: 'transparent',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeSanitize,
            {
              tagNames: [
                ...(defaultSchema.tagNames! as string[]),
                'command',
                'attemptcompletion',
                ...toolTagNames,
                'diff',
              ],
            },
          ],
        ]}
        components={
          {
            diff: (props: any) => {
              const { node } = props;
              // 去掉 user-content- 前缀
              const id = node?.properties?.id?.replace(/^user-content-/, '');
              const rawDiff = id ? diffMap[id] : '';
              // 解析 rawDiff 为 original 和 modified
              let original = '',
                modified = '';
              if (rawDiff) {
                const match = rawDiff.match(
                  /<{2,} *SEARCH([\s\S]*?)={2,}([\s\S]*?)>{2,} *REPLACE/
                );
                if (match) {
                  // 清理行号标记和分隔线
                  const cleanDiff = (str: string) =>
                    str
                      .replace(/:start_line:\d+\n?[-=]+/g, '')
                      .replace(/^-{2,}\n?/gm, '')
                      .replace(/^={2,}\n?/gm, '')
                      .replace(/^\s+|\s+$/g, '');
                  original = cleanDiff(match[1].trim());
                  modified = cleanDiff(match[2].trim());
                }
              }
              return (
                <Diff
                  original={original}
                  modified={modified}
                  language='javascript'
                  height={400}
                />
              );
            },
            a: ({
              children,
              style,
              ...rest
            }: React.HTMLAttributes<HTMLAnchorElement>) => (
              <a
                {...rest}
                target='_blank'
                rel='noopener noreferrer'
                style={{
                  color: theme.palette.primary.main,
                  textDecoration: 'underline',
                  ...style,
                }}
              >
                {children}
              </a>
            ),
            img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
              const { style, alt, ...rest } = props;
              return (
                <img
                  alt={alt || 'markdown-img'}
                  {...rest}
                  style={{
                    ...style,
                    borderRadius: '10px',
                    marginLeft: '5px',
                    boxShadow: '0px 0px 3px 1px rgba(0,0,5,0.15)',
                    cursor: 'pointer',
                  }}
                  referrerPolicy='no-referrer'
                />
              );
            },
            command: ({ children }: React.HTMLAttributes<HTMLElement>) => {
              return (
                <SyntaxHighlighter
                  language={'shell'}
                  style={github}
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(
                        String(children).replace(/\n$/, '')
                      );
                      message.success('复制成功');
                    }
                  }}
                >
                  {String(children)}
                </SyntaxHighlighter>
              );
            },
            attemptcompletion: (props: React.HTMLAttributes<HTMLElement>) => {
              return (
                <div
                  style={{
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #0ea5e9',
                    borderRadius: '8px',
                    padding: '12px',
                    margin: '8px 0',
                    color: '#0c4a6e',
                  }}
                >
                  {props.children}
                </div>
              );
            },
            code({
              children,
              className,
              ...rest
            }: React.HTMLAttributes<HTMLElement>) {
              const match = /language-(\w+)/.exec(className || '');
              return match ? (
                <SyntaxHighlighter
                  showLineNumbers
                  {...rest}
                  language={match[1] || 'bash'}
                  style={anOldHope}
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(
                        String(children).replace(/\n$/, '')
                      );
                      message.success('复制成功');
                    }
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              ) : (
                <code
                  {...rest}
                  className={className}
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(String(children));
                      message.success('复制成功');
                    }
                  }}
                >
                  {children}
                </code>
              );
            },
          } as ExtendedComponents
        }
      >
        {answer}
      </ReactMarkdown>
    </Box>
  );
};

export default MarkDown;
