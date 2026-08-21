// 分屏布局树(tmux/iTerm 同构;2026-08-16 用户终案「让用户自定义,随便他
// 搞」):布局是一棵用户拆出来的二叉树,叶 = 槽位,内部节点 = 一次切分
// (方向 + 比例)。**每条分隔线恰是一个内部节点,天生只影响它的两个子树**
// ——此前固定 2×2 档位下"拖一条线牵动别的格"的三轮拉扯(先横切/先竖切/
// 翻向)到这里整体消解:共享线只在用户自己把树拆成那个形状时存在。
// 档位(1/2横/2纵/4)降级为快捷模板,只是四棵预设树。
// 全部纯函数,useSplitState 只做接线;产品语义单测钉在这里。
import { SPLIT_MAX_PANES } from "@/lib/util/prefs";

export type SplitDir = "col" | "row";

export type SplitNode =
  | { leaf: number }
  | { dir: SplitDir; ratio: number; a: SplitNode; b: SplitNode };

/** 预设模板(名字沿用布局档词汇;四格 = 先竖切,视觉槽位 左上0 右上1
 *  左下2 右下3)。比例恒 0.5:模板是形状不是尺寸,用户的比例在拆完的
 *  树上自己拖。 */
export const PRESETS = {
  "1": { leaf: 0 } as SplitNode,
  "2col": { dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } } as SplitNode,
  "2row": { dir: "row", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } } as SplitNode,
  "4": {
    dir: "col",
    ratio: 0.5,
    a: { dir: "row", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 2 } },
    b: { dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 3 } },
  } as SplitNode,
} as const;

export type PresetKey = keyof typeof PRESETS;

const MAX_DEPTH = 5; // 6 叶的树最深 5 层;再深必是坏档/恶意档

const clampRatio = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(0.8, Math.max(0.2, v)) : 0.5;

/** 叶槽位序(中序 = 视觉阅读序;可见集/焦点轮转/播种都按它)。 */
export function leaves(node: SplitNode): number[] {
  return "leaf" in node ? [node.leaf] : [...leaves(node.a), ...leaves(node.b)];
}

export function paneCount(node: SplitNode): number {
  return leaves(node).length;
}

/** 坏档校验(localStorage 手改/旧格式):形状/方向/深度/叶数/槽位唯一且
 *  在界内,任何一条不满足整树作废(部分修复会造出没人见过的布局)。 */
export function validateTree(raw: unknown): SplitNode | null {
  const seen = new Set<number>();
  const walk = (v: unknown, depth: number): SplitNode | null => {
    if (depth > MAX_DEPTH || !v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if ("leaf" in o) {
      const slot = o.leaf;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPLIT_MAX_PANES) return null;
      if (seen.has(slot)) return null;
      seen.add(slot);
      return { leaf: slot };
    }
    if (o.dir !== "col" && o.dir !== "row") return null;
    const a = walk(o.a, depth + 1);
    const b = walk(o.b, depth + 1);
    if (!a || !b) return null;
    return { dir: o.dir, ratio: clampRatio(o.ratio), a, b };
  };
  const tree = walk(raw, 0);
  return tree && seen.size <= SPLIT_MAX_PANES ? tree : null;
}

/** 节点寻址:根 "";子路径追加 "a"/"b"。把手按路径改比例,拖谁动谁。 */
export function setRatio(node: SplitNode, path: string, ratio: number): SplitNode {
  if ("leaf" in node) return node;
  if (path === "") return { ...node, ratio: clampRatio(ratio) };
  const head = path[0];
  return head === "a"
    ? { ...node, a: setRatio(node.a, path.slice(1), ratio) }
    : { ...node, b: setRatio(node.b, path.slice(1), ratio) };
}

/** 拆分某叶(向右 = col / 向下 = row):新格取未被任何叶占用的最小槽号,
 *  原格在前新格在后;到叶数上限返回 null(调用方置灰按钮)。 */
export function splitLeaf(node: SplitNode, slot: number, dir: SplitDir): { tree: SplitNode; newSlot: number } | null {
  const used = new Set(leaves(node));
  let newSlot = -1;
  for (let i = 0; i < SPLIT_MAX_PANES; i++) {
    if (!used.has(i)) {
      newSlot = i;
      break;
    }
  }
  if (newSlot < 0) return null;
  const walk = (n: SplitNode): SplitNode =>
    "leaf" in n
      ? n.leaf === slot
        ? { dir, ratio: 0.5, a: { leaf: slot }, b: { leaf: newSlot } }
        : n
      : { ...n, a: walk(n.a), b: walk(n.b) };
  const tree = walk(node);
  return tree === node ? null : { tree, newSlot };
}

/** 关闭某叶:兄弟子树上位(tmux 收格语义);最后一叶不许关(返回原树,
 *  出口是退出分屏不是关光格子)。 */
export function removeLeaf(node: SplitNode, slot: number): SplitNode {
  if ("leaf" in node) return node;
  const walk = (n: SplitNode): SplitNode | null => {
    if ("leaf" in n) return n.leaf === slot ? null : n;
    const a = walk(n.a);
    const b = walk(n.b);
    if (a && b) return a === n.a && b === n.b ? n : { ...n, a, b };
    return a ?? b; // 一侧整体消失:兄弟上位
  };
  return walk(node) ?? node;
}

/** 交换两叶的槽位(拖格头换位;两叶都得在树上,否则原样返回)。 */
export function swapLeaves(node: SplitNode, x: number, y: number): SplitNode {
  const present = new Set(leaves(node));
  if (x === y || !present.has(x) || !present.has(y)) return node;
  const walk = (n: SplitNode): SplitNode =>
    "leaf" in n
      ? n.leaf === x
        ? { leaf: y }
        : n.leaf === y
          ? { leaf: x }
          : n
      : { ...n, a: walk(n.a), b: walk(n.b) };
  return walk(node);
}

/** 形状等价(忽略比例):header 档位钮的按下态按它判——用户拖过比例的
 *  四格仍是"四格"。 */
export function sameShape(a: SplitNode, b: SplitNode): boolean {
  if ("leaf" in a || "leaf" in b) return "leaf" in a && "leaf" in b && a.leaf === b.leaf;
  return a.dir === b.dir && sameShape(a.a, b.a) && sameShape(a.b, b.b);
}
