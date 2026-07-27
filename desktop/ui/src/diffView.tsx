// diff 呈现:unified diff 解析成带行号的行,再按增删着色渲染(改动抽屉 / 工具卡详情共用)。
import { useMemo } from "react";
import { MONO } from "./fonts";

interface DiffRow {
  no: string;
  text: string;
  kind: "h" | "add" | "del" | "ctx";
}

/** unified diff → 带行号的行(行号取新文件侧,删除行取旧文件侧) */
function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldN = 0;
  let newN = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      oldN = +m[1];
      newN = +m[2];
      rows.push({ no: "", text: line, kind: "h" });
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    )
      continue;
    if (line.startsWith("+")) {
      rows.push({ no: String(newN++), text: line, kind: "add" });
    } else if (line.startsWith("-")) {
      rows.push({ no: String(oldN++), text: line, kind: "del" });
    } else {
      rows.push({ no: String(newN), text: line, kind: "ctx" });
      oldN++;
      newN++;
    }
  }
  return rows;
}

/** diff 面板(改动抽屉的行渲染:36px 行号列 + hunk 灰条 + 增删着色) */
export function DiffPanel({ text }: { text: string }) {
  const rows = useMemo(() => parseDiff(text), [text]);
  if (!rows.some((r) => r.kind === "h")) {
    // 非 diff 内容(加载中/错误/无差异提示)
    return (
      <pre style={{ margin: 0, padding: "10px 24px", font: "12px/1.9 " + MONO, color: "var(--t4)", whiteSpace: "pre-wrap" }}>
        {text}
      </pre>
    );
  }
  return (
    <div style={{ font: "12px/1.9 " + MONO }}>
      {rows.map((r, i) =>
        r.kind === "h" ? (
          <div key={i} style={{ display: "flex", padding: "2px 24px", background: "var(--codeBg)", color: "var(--t4)", fontSize: 11 }}>
            <span style={{ width: 36, flex: "none" }} />
            <span className="selectable" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.text}</span>
          </div>
        ) : (
          <div
            key={i}
            className="mc-preview-line mc-diff-line"
            data-line-number={r.no}
            style={{
              display: "flex",
              padding: "0 24px",
              background: r.kind === "add" ? "var(--addBg)" : r.kind === "del" ? "var(--delBg)" : "transparent",
              color: r.kind === "add" ? "var(--addT)" : r.kind === "del" ? "var(--delT)" : "var(--t3)",
            }}
          >
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", minWidth: 0 }}>{r.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
