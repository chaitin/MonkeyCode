import Card from '@/components/card';
import { getCompletionInfo } from '@/api/Billing';
import { Modal } from '@c-x/ui';
import MonacoEditor from '@monaco-editor/react';

import { useEffect, useState, useRef } from 'react';
import { DomainCompletionRecord } from '@/api/types';
import { getBaseLanguageId } from '@/utils';

// 删除 <|im_start|> 和 <|im_end|> 及其间内容的工具函数
const removeImBlocks = (text: string) => {
  // 匹配前后可能的换行符
  return text.replace(
    /(^[ \t]*\r?\n)?<\|im_start\|>[\s\S]*?<\|im_end\|>(\r?\n)?/g,
    ''
  );
};

const ChatDetailModal = ({
  data,
  open,
  onClose,
}: {
  data?: DomainCompletionRecord;
  open: boolean;
  onClose: () => void;
}) => {
  const [editorValue, setEditorValue] = useState<string>('');
  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [highlightInfo, setHighlightInfo] = useState<any>(null);

  const getChatDetailModal = () => {
    if (!data) return;
    getCompletionInfo({ id: data.id! }).then((res) => {
      // 先去除 <|im_start|> 和 <|im_end|> 及其间内容
      const rawPrompt = removeImBlocks(res.prompt || '');
      const content = res.content || '';
      // 找到三个特殊标记的位置
      const prefixTag = '<|fim_prefix|>';
      const suffixTag = '<|fim_suffix|>';
      const middleTag = '<|fim_middle|>';
      const prefixIdx = rawPrompt.indexOf(prefixTag);
      const suffixIdx = rawPrompt.indexOf(suffixTag);
      const middleIdx = rawPrompt.indexOf(middleTag);
      // 去掉特殊标记
      const prompt = rawPrompt
        .replace(prefixTag, '')
        .replace(suffixTag, '')
        .replace(middleTag, '');
      // 重新定位插入点（因为去掉了前面的 tag，位置会变）
      // 计算插入点：suffixTag 在原始 prompt 的位置，去掉 prefixTag 后的 offset
      let insertIdx = suffixIdx;
      if (prefixIdx !== -1 && prefixIdx < suffixIdx) {
        insertIdx -= prefixTag.length;
      }
      if (middleIdx !== -1 && middleIdx < suffixIdx) {
        insertIdx -= middleTag.length;
      }
      // 插入 content
      const newValue =
        prompt.slice(0, insertIdx) + content + prompt.slice(insertIdx);
      setEditorValue(newValue);
      // 计算高亮范围（行列）
      const before = newValue.slice(0, insertIdx);
      const contentLines = content.split('\n');
      const beforeLines = before.split('\n');
      const startLine = beforeLines.length;
      const startColumn = beforeLines[beforeLines.length - 1].length + 1;
      const endLine = startLine + contentLines.length - 1;
      const endColumn =
        contentLines.length === 1
          ? startColumn + content.length
          : contentLines[contentLines.length - 1].length + 1;
      setHighlightInfo({ startLine, startColumn, endLine, endColumn });
    });
  };

  useEffect(() => {
    if (editorReady && highlightInfo && editorRef.current) {
      editorRef.current.deltaDecorations(
        [],
        [
          {
            range: {
              startLineNumber: highlightInfo.startLine,
              startColumn: highlightInfo.startColumn,
              endLineNumber: highlightInfo.endLine,
              endColumn: highlightInfo.endColumn,
            },
            options: {
              inlineClassName: 'completion-highlight',
            },
          },
        ]
      );
    }
  }, [editorReady, highlightInfo, editorValue]);

  useEffect(() => {
    if (open) getChatDetailModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, open]);

  return (
    <Modal
      title='代码补全'
      width={800}
      open={open}
      onCancel={onClose}
      footer={null}
    >
      <Card sx={{ p: 0 }}>
        <div style={{ height: 420 }}>
          <MonacoEditor
            height='100%'
            language={getBaseLanguageId(data?.program_language || 'plaintext')}
            value={editorValue}
            theme='vs-dark'
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 14,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'off',
              glyphMargin: false,
              folding: false,
              overviewRulerLanes: 0,
              guides: {
                indentation: true,
                highlightActiveIndentation: true,
                highlightActiveBracketPair: false,
              },
              renderLineHighlight: 'none',
              cursorStyle: 'line',
              cursorBlinking: 'solid',
              cursorWidth: 0,
              contextmenu: false,
              selectionHighlight: false,
              selectOnLineNumbers: false,
              occurrencesHighlight: 'off',
              links: false,
              hover: { enabled: false },
              codeLens: false,
              dragAndDrop: false,
              mouseWheelZoom: false,
              accessibilitySupport: 'off',
              bracketPairColorization: { enabled: false },
              matchBrackets: 'never',
            }}
            onMount={(editor) => {
              editorRef.current = editor;
              setEditorReady(true);
              // 隐藏光标
              const editorDom = editor.getDomNode();
              if (editorDom) {
                const style = document.createElement('style');
                style.innerHTML = `.monaco-editor .cursor { display: none !important; }`;
                editorDom.appendChild(style);
              }
            }}
          />
        </div>
        <style>{`
          .completion-highlight {
            background: #264f78 !important;
            transition: background 0.2s;
          }
        `}</style>
      </Card>
    </Modal>
  );
};

export default ChatDetailModal;
