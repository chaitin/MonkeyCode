import React, { useRef } from 'react';
import { DiffEditor } from '@monaco-editor/react';

interface DiffProps {
  original: string;
  modified: string;
  language?: string;
  height?: string | number;
}

const Diff: React.FC<DiffProps> = ({
  original,
  modified,
  language = 'javascript',
  height = 400,
}) => {
  // 处理高度和宽度样式
  const boxHeight = typeof height === 'number' ? `${height}px` : height;
  const boxWidth = 1000; // 默认宽度800px

  return (
    <div
      style={{ height: boxHeight, width: boxWidth }}
      className='monaco-diff-editor-wrapper'
    >
      <DiffEditor
        height='100%'
        width='100%'
        language={language}
        original={original}
        modified={modified}
        theme='vs-dark'
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: false,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'hidden',
            handleMouseWheel: false,
            alwaysConsumeMouseWheel: false,
            useShadows: false,
          },
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
      />
    </div>
  );
};

export default Diff;
