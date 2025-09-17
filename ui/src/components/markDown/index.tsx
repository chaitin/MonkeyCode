import { message } from '@ctzhian/ui';
import { Box, useTheme } from '@mui/material';
import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { getBaseLanguageId } from '@/utils';
import Diff from './diff';
import Code from './code';
import Command from './command';

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
  'follow_up',
];

// 去掉下划线的标签名，用于Markdown渲染
export const toolTagNames = toolNames.map((name) => name.replace(/_/g, ''));

// 提取 <write_to_file> 块，解析 path、content、language，支持多个 <content>，每个加唯一 id，返回 newText 和 contentMap
export interface WriteToFileContentMap {
  [id: string]: {
    code: string;
    path: string;
    language: string;
  };
}

export function preprocessWriteToFile(text: string) {
  let contentIndex = 0;
  const contentMap: WriteToFileContentMap = {};
  // 替换所有 <content>...</content> 为 <content id="content-x"></content> 并存入 contentMap
  const newText = text.replace(
    /<content>([\s\S]*?)(<\/content>|$)/g,
    (match, code) => {
      const id = `content-${contentIndex++}`;
      // 尝试提取 path
      let path = '';
      let language = '';
      // 向前查找最近的 <path> 标签
      const pathMatch = text
        .slice(0, text.indexOf(match))
        .match(/<path>([\s\S]*?)<\/path>/);
      if (pathMatch) {
        path = pathMatch[1].trim();
        language = getBaseLanguageId(path.split('.').pop() || 'plaintext');
      }
      contentMap[id] = { code: code.trim(), path, language };
      return `<content id="${id}"></content>`;
    }
  );
  return { newText, contentMap };
}

// 支持多组 diff 分隔符，容错处理
function parseAndMergeDiffs(diffText: string) {
  const diffBlocks: { search: string; replace: string }[] = [];
  const lines = diffText.split('\n');
  let inDiff = false;
  let inSearch = false;
  let inReplace = false;
  let searchBuffer: string[] = [];
  let replaceBuffer: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^<+ *SEARCH/.test(line)) {
      inDiff = true;
      inSearch = true;
      inReplace = false;
      searchBuffer = [];
      replaceBuffer = [];
      continue;
    }
    if (/^====+$/.test(line)) {
      if (inDiff && inSearch) {
        inSearch = false;
        inReplace = true;
        continue;
      }
    }
    if (/^>+ *REPLACE/.test(line)) {
      if (inDiff && inReplace) {
        diffBlocks.push({
          search: searchBuffer.join('\n'),
          replace: replaceBuffer.join('\n'),
        });
        inDiff = false;
        inReplace = false;
        continue;
      }
    }
    if (inDiff) {
      if (inSearch) {
        searchBuffer.push(line);
      } else if (inReplace) {
        replaceBuffer.push(line);
      }
    }
  }
  // 容错：如果最后一组没有正常结束
  if (inDiff) {
    diffBlocks.push({
      search: searchBuffer.join('\n'),
      replace: replaceBuffer.join('\n'),
    });
  }

  const mergedSearch = diffBlocks.map((b) => b.search).join('\n');
  const mergedReplace = diffBlocks.map((b) => b.replace).join('\n');

  return { mergedSearch, mergedReplace, diffBlocks };
}

// 预处理 markdown，提取所有 <diff> 内容，生成 diffMap
function preprocessMarkdown(mdContent: string) {
  let diffIndex = 0;
  const diffMap: Record<string, string> = {};
  // 自动补全未闭合的 </diff>
  let fixedMd = mdContent;
  const openDiffCount = (fixedMd.match(/<diff>/g) || []).length;
  const closeDiffCount = (fixedMd.match(/<\/diff>/g) || []).length;
  if (openDiffCount > closeDiffCount) {
    // 补全缺失的 </diff>
    for (let i = 0; i < openDiffCount - closeDiffCount; i++) {
      fixedMd += '</diff>';
    }
  }
  const newMd = fixedMd.replace(
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
}: {
  loading?: boolean;
  content: string;
}) => {
  const theme = useTheme();

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
  const { newText, contentMap: writeToFileContentMap } =
    preprocessWriteToFile(newMd);
  const answerMd = processContent(newText);

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
                ...toolTagNames,
                'diff',
                'suggest',
                'content',
              ],
            },
          ],
        ]}
        components={
          {
            followup: (props: any) => {
              return <ul>{props.children}</ul>;
            },
            suggest: (props: any) => {
              return <li>{props.children}</li>;
            },

            diff: (props: any) => {
              const { node } = props;
              // 去掉 user-content- 前缀
              const id = node?.properties?.id?.replace(/^user-content-/, '');
              const rawDiff = id ? diffMap[id] : '';
              let original = '',
                modified = '';
              if (rawDiff) {
                const { mergedSearch, mergedReplace } =
                  parseAndMergeDiffs(rawDiff);
                // 清理行号标记和分隔线
                const cleanDiff = (str: string) =>
                  str
                    .replace(/:start_line:\d+\n?[-=]+/g, '')
                    .replace(/^-{2,}\n?/gm, '')
                    .replace(/^={2,}\n?/gm, '')
                    .replace(/^\n+|\n+$/g, '');
                original = cleanDiff(mergedSearch);
                modified = cleanDiff(mergedReplace);
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
            command: async ({
              children,
            }: React.HTMLAttributes<HTMLElement>) => {
              return <Command lang='shell'>{children}</Command>;
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
                <Command>{String(children).replace(/\n$/, '')}</Command>
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
            content: (props: any) => {
              const id = props.node?.properties?.id?.replace(
                /^user-content-/,
                ''
              );
              const block = id ? writeToFileContentMap[id] : undefined;
              if (!block) return null;
              return (
                <Code
                  data={block.code}
                  language={block.language || 'text'}
                  autoHeight={false}
                  autoWidth={false}
                />
              );
            },
          } as ExtendedComponents
        }
      >
        {answerMd}
      </ReactMarkdown>
    </Box>
  );
};

export default MarkDown;
