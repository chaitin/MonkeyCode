import type { MessageType } from "../message";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import { createPatch } from "diff";

export const renderTitle = (message: MessageType) => {
  return `修改文件 "${message.data.rawInput?.file_path || message.data._meta?.claudeCode?.toolResponse?.filePath}"`
}

export const renderDetail = (message: MessageType) => {
  const oldString = message.data.rawInput?.old_string || message.data._meta?.claudeCode?.toolResponse?.oldString || "";
  const newString = message.data.rawInput?.new_string || message.data.rawInput?.content || message.data._meta?.claudeCode?.toolResponse?.newString || message.data._meta?.claudeCode?.toolResponse?.content || "";
  const filePath = message.data.rawInput?.file_path;

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
      className="text-xs p-3"
      style={{ '--diff-font-family': 'var(--font-google-sans-code)' } as React.CSSProperties}
    >
      {files.map((file, index) => (
        <Diff key={index} viewType={!oldString ?  "unified" : "split"} diffType={file.type} hunks={file.hunks} gutterType="none" >
          {(hunks) => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
}