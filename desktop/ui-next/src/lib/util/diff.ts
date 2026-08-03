// unified diff → 行模型(纯函数,渲染无关)。
// 契约:输入是壳侧 repo_file_diff 返回的 git unified diff 文本(不可信,
// 调用方一律按纯文本渲染);输出逐行带新旧行号,文件头(diff/index/---/+++/
// mode/rename 等)一律不进模型——判据不是前缀枚举,而是「hunk 之外的行都是
// 头部」(裸 "diff " 行重置 hunk 态),多文件 diff 与 --no-index 构造的
// 全新增 diff 同样成立(hunk 内的行必带 ' '/'+'/'-'/'\' 前缀,撞不上)。
export type DiffRowKind = "hunk" | "add" | "del" | "ctx" | "meta";

export interface DiffRow {
  kind: DiffRowKind;
  /** add/del/ctx:去掉首列标记后的内容;hunk/meta:原样整行 */
  text: string;
  /** 旧文件侧行号(del/ctx 有) */
  oldNo?: number;
  /** 新文件侧行号(add/ctx 有) */
  newNo?: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 是否含 hunk 头(渲染层据此在 diff 视图与纯文本兜底之间二择)。 */
export function isUnifiedDiff(text: string): boolean {
  return text.split("\n").some((line) => HUNK.test(line));
}

export function parseUnifiedDiff(text: string): DiffRow[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop(); // git 输出以换行结尾,别产出幽灵行
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of lines) {
    const m = HUNK.exec(line);
    if (m) {
      oldNo = Number(m[1] ?? "0");
      newNo = Number(m[2] ?? "0");
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("diff ")) {
      inHunk = false; // 下一个文件的头部区开始
      continue;
    }
    if (!inHunk) continue; // 首个 hunk 之前 / 文件之间的头部行
    if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line }); // "\ No newline at end of file"
      continue;
    }
    if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    else rows.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return rows;
}
