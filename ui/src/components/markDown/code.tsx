import MonacoEditor from '@monaco-editor/react';
import { getBaseLanguageId } from '@/utils';
import { useRef, useState, useEffect } from 'react';

const CHAR_WIDTH = 8; // 估算每个字符宽度，实际可根据字体调整
const MIN_WIDTH = 200;
const MAX_WIDTH = 960;
const MAX_HEIGHT = 420;

const Code = ({
  data,
  language,
  options,
  autoHeight = true,
  autoWidth = true,
}: {
  data: string;
  language: string;
  options?: any;
  autoHeight?: boolean;
  autoWidth?: boolean;
}) => {
  const editorRef = useRef<any>(null);
  const [height, setHeight] = useState(420);
  const [width, setWidth] = useState(MAX_WIDTH);

  // 动态调整高度和宽度
  const updateSize = () => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    // 获取视觉高度（自适应视觉行数）
    if (autoHeight) {
      const contentHeight = editorRef.current.getContentHeight();
      const newHeight = Math.min(contentHeight, MAX_HEIGHT);
      setHeight(newHeight);
    }

    if (autoWidth) {
      const lines = model.getLinesContent();

      const maxLineLength = lines.reduce(
        (max: number, line: string) => Math.max(max, line.length),
        0
      );
      const newWidth = Math.min(
        Math.max(maxLineLength * CHAR_WIDTH + 40, MIN_WIDTH),
        MAX_WIDTH
      );
      setWidth(newWidth);
    }
  };

  useEffect(() => {
    updateSize();
  }, [data]);

  // 监听编辑器内容变化和布局变化，动态调整高度
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    updateSize();
    editor.onDidContentSizeChange(() => {
      updateSize();
    });
    // 隐藏光标
    const editorDom = editor.getDomNode();
    if (editorDom) {
      const style = document.createElement('style');
      style.innerHTML = `.monaco-editor .cursor { display: none !important; }`;
      editorDom.appendChild(style);
    }
  };

  return (
    <MonacoEditor
      height={height}
      width={width}
      language={getBaseLanguageId(language || 'plaintext')}
      value={data}
      theme='vs-dark'
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
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
        lineNumbers: 'off',
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
        scrollbar: {
          vertical: 'hidden',
        },
        ...options,
      }}
      onMount={handleEditorDidMount}
    />
  );
};

export default Code;
