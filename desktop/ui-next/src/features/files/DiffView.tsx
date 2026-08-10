// unified diff 呈现:hunk 灰条 + 新旧行号双栏 + 增删行浅底(success/error
// 语义色,双主题自动跟随)。diff 文本是不可信输入,一律按纯文本渲染
// (不进 innerHTML);解析在 lib/util/diff(纯函数,单测在那边)。
import { useMemo } from "react";

import { parseUnifiedDiff, type DiffRow } from "@/lib/util/diff";

export function DiffView({ text }: { text: string }) {
  const rows = useMemo(() => parseUnifiedDiff(text), [text]);
  if (!rows.some((r) => r.kind === "hunk")) {
    // 非 diff 内容(错误/提示文案)按纯文本兜底
    return (
      <pre className="select-text px-4 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere text-base-content/70">
        {text}
      </pre>
    );
  }
  return (
    <div className="select-text py-1 font-mono text-xs leading-relaxed">
      {rows.map((row, i) => (
        <Row key={i} row={row} />
      ))}
    </div>
  );
}

function Row({ row }: { row: DiffRow }) {
  if (row.kind === "hunk") {
    return (
      <div className="flex bg-base-200 px-4 py-0.5 text-xs text-base-content/50">
        <span className="whitespace-pre-wrap wrap-anywhere">{row.text}</span>
      </div>
    );
  }
  if (row.kind === "meta") {
    return (
      <div className="flex px-4 text-base-content/40">
        <span aria-hidden className="w-20 shrink-0 select-none" />
        <span className="whitespace-pre-wrap wrap-anywhere">{row.text}</span>
      </div>
    );
  }
  const tone = row.kind === "add" ? "bg-success/10" : row.kind === "del" ? "bg-error/10" : "";
  const mark = row.kind === "add" ? "+" : row.kind === "del" ? "-" : "";
  const markTone = row.kind === "add" ? "text-success" : row.kind === "del" ? "text-error" : "";
  return (
    <div className={`flex px-4 ${tone}`}>
      <span aria-hidden className="w-8 shrink-0 select-none pr-1 text-right text-base-content/35 tabular-nums">
        {row.oldNo ?? ""}
      </span>
      <span aria-hidden className="w-8 shrink-0 select-none pr-2 text-right text-base-content/35 tabular-nums">
        {row.newNo ?? ""}
      </span>
      <span aria-hidden className={`w-4 shrink-0 select-none ${markTone}`}>
        {mark}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">{row.text || " "}</span>
    </div>
  );
}
