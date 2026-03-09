import type { MessageType } from "../message";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import { createPatch } from "diff";

export const renderTitle = (message: MessageType) => {
  return `修改文件${message.data.rawInput?.filePath ? ` "${message.data.rawInput?.filePath}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  const oldString = message.data.rawInput?.oldString || "";
  const newString = message.data.rawInput?.newString || message.data.rawInput?.content || "";
  const filePath = message.data.rawInput?.filePath;

  let diffText = createPatch(filePath || "", oldString || "", newString || "", "", "", {
    headerOptions: {
      includeIndex: false,
      includeUnderline: false,
      includeFileHeaders: true,
    }
  })
  
  const files = diffText ? parseDiff(diffText) : [];

  return (
    <div 
      className="text-xs max-h-[50vh] overflow-auto border rounded-md"
      style={{ '--diff-font-family': 'var(--font-google-sans-code)' } as React.CSSProperties}
    >
      <style>{`
        .user-diff-style .diff-line td:nth-child(2) {
          border-left: 1px var(--border) solid;
        }
      `}</style>
      {files.map((file, index) => (
        <Diff key={index} viewType={!oldString ?  "unified" : "split"} diffType={file.type} hunks={file.hunks} gutterType="none" hunkClassName="user-diff-style" >
          {(hunks) => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
}