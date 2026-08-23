// 分屏布局树(tmux/iTerm 同构;2026-08-16 用户终案「让用户自定义,随便他
// 搞」):布局是一棵用户拆出来的二叉树,叶 = 槽位,内部节点 = 一次切分
// (方向 + 比例)。**每条分隔线恰是一个内部节点,天生只影响它的两个子树**
// ——此前固定 2×2 档位下"拖一条线牵动别的格"的三轮拉扯(先横切/先竖切/
// 翻向)到这里整体消解:共享线只在用户自己把树拆成那个形状时存在。
// 档位(1/2横/2纵/4)降级为快捷模板,只是四棵预设树。
// 全部纯函数,useSplitState 只做接线;产品语义单测钉在这里。
export type SplitDir = "col" | "row";
export type SplitRootEdge = "top" | "right";

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

// 比例边界只保证树值合法，不与格子数量绑定；交互时按当前像素区域另加
// 可见尺寸下限，渲染时也会跳过不足一个像素的子树。
export const SPLIT_MIN_RATIO = Number.EPSILON;
export const SPLIT_MAX_RATIO = 1 - SPLIT_MIN_RATIO;

const clampRatio = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, v))
    : 0.5;

/** 叶槽位序(中序 = 视觉阅读序;可见集/焦点轮转/播种都按它)。 */
export function leaves(node: SplitNode): number[] {
  const result: number[] = [];
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ("leaf" in current) result.push(current.leaf);
    else pending.push(current.b, current.a);
  }
  return result;
}

export function paneCount(node: SplitNode): number {
  let count = 0;
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ("leaf" in current) count += 1;
    else pending.push(current.a, current.b);
  }
  return count;
}

/** 坏档校验(localStorage 手改/旧格式):形状/方向/槽位为非负安全整数且
 *  唯一,任何一条不满足整树作废(部分修复会造出没人见过的布局)。迭代
 *  后序遍历避免异常深存档在应用启动时耗尽调用栈。 */
export function validateTree(raw: unknown): SplitNode | null {
  type Pending =
    | { kind: "visit"; value: unknown }
    | { kind: "join"; dir: SplitDir; ratio: number };

  const seenSlots = new Set<number>();
  const seenObjects = new WeakSet<object>();
  const pending: Pending[] = [{ kind: "visit", value: raw }];
  const built: SplitNode[] = [];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.kind === "join") {
      const b = built.pop();
      const a = built.pop();
      if (!a || !b) return null;
      built.push({ dir: item.dir, ratio: item.ratio, a, b });
      continue;
    }

    const value = item.value;
    if (!value || typeof value !== "object" || seenObjects.has(value)) return null;
    seenObjects.add(value);
    const object = value as Record<string, unknown>;
    if ("leaf" in object) {
      const slot = object.leaf;
      if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0 || seenSlots.has(slot)) return null;
      seenSlots.add(slot);
      built.push({ leaf: slot });
      continue;
    }
    if (object.dir !== "col" && object.dir !== "row") return null;
    pending.push(
      { kind: "join", dir: object.dir, ratio: clampRatio(object.ratio) },
      { kind: "visit", value: object.b },
      { kind: "visit", value: object.a },
    );
  }
  return built.length === 1 ? built[0]! : null;
}

function transformTree<T>(
  root: SplitNode,
  leaf: (node: Extract<SplitNode, { leaf: number }>) => T,
  branch: (node: Extract<SplitNode, { dir: SplitDir }>, a: T, b: T) => T,
): T {
  const pending: { node: SplitNode; expanded: boolean }[] = [{ node: root, expanded: false }];
  const built: T[] = [];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if ("leaf" in item.node) {
      built.push(leaf(item.node));
    } else if (item.expanded) {
      const b = built.pop()!;
      const a = built.pop()!;
      built.push(branch(item.node, a, b));
    } else {
      pending.push({ node: item.node, expanded: true }, { node: item.node.b, expanded: false }, { node: item.node.a, expanded: false });
    }
  }
  return built[0]!;
}

/** 恢复存档时把稀疏/超大槽号压成稠密编号；只换叶标签，不改树形、比例
 * 或视觉顺序。迭代实现保证恶意深树不会重新引入调用栈风险。 */
export function remapLeaves(node: SplitNode, remap: ReadonlyMap<number, number>): SplitNode {
  return transformTree<SplitNode>(
    node,
    (current) => ({ leaf: remap.get(current.leaf) ?? current.leaf }),
    (current, a, b) => ({ ...current, a, b }),
  );
}

/** 节点寻址:根 "";子路径追加 "a"/"b"。把手按路径改比例,拖谁动谁。 */
export function setRatio(node: SplitNode, path: string, ratio: number): SplitNode {
  const ancestors: { node: Extract<SplitNode, { dir: SplitDir }>; side: "a" | "b" }[] = [];
  let current = node;
  let offset = 0;
  while (!("leaf" in current) && offset < path.length) {
    const side = path[offset] === "a" ? "a" : "b";
    ancestors.push({ node: current, side });
    current = current[side];
    offset += 1;
  }
  let replacement = "leaf" in current || offset < path.length ? current : { ...current, ratio: clampRatio(ratio) };
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const { node: parent, side } = ancestors[i]!;
    replacement = side === "a" ? { ...parent, a: replacement } : { ...parent, b: replacement };
  }
  return replacement;
}

/** 双击某条分隔线时,只在它辖下的子树按叶数递归分配面积。比如左侧
 * 有上下两格、右侧一格,根比例为 2/3:1/3,左侧内部再取 1/2:1/2；
 * 于是三格等面积。路径外的布局保持不动。 */
export function equalizeAt(node: SplitNode, path: string): SplitNode {
  const ancestors: { node: Extract<SplitNode, { dir: SplitDir }>; side: "a" | "b" }[] = [];
  let target = node;
  let offset = 0;
  while (!("leaf" in target) && offset < path.length) {
    const side = path[offset] === "a" ? "a" : "b";
    ancestors.push({ node: target, side });
    target = target[side];
    offset += 1;
  }
  if ("leaf" in target || offset < path.length) return node;

  const equalized = transformTree(
    target,
    (leaf) => ({ node: leaf as SplitNode, count: 1 }),
    (branch, a, b) => ({
      node: { ...branch, ratio: clampRatio(a.count / (a.count + b.count)), a: a.node, b: b.node } as SplitNode,
      count: a.count + b.count,
    }),
  ).node;
  let replacement = equalized;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const { node: parent, side } = ancestors[i]!;
    replacement = side === "a" ? { ...parent, a: replacement } : { ...parent, b: replacement };
  }
  return replacement;
}

/** 拆分某叶(向右 = col / 向下 = row):新格取未被任何叶占用的最小槽号,
 *  原格在前新格在后。 */
export function splitLeaf(node: SplitNode, slot: number, dir: SplitDir): { tree: SplitNode; newSlot: number } | null {
  const used = new Set(leaves(node));
  let newSlot = 0;
  while (used.has(newSlot)) newSlot += 1;
  const tree = transformTree<SplitNode>(
    node,
    (leaf) => (leaf.leaf === slot ? { dir, ratio: 0.5, a: { leaf: slot }, b: { leaf: newSlot } } : leaf),
    (branch, a, b) => (a === branch.a && b === branch.b ? branch : { ...branch, a, b }),
  );
  return tree === node ? null : { tree, newSlot };
}

/** 从整个主视图上边缘或右边缘插入新叶。 */
export function insertRootLeaf(node: SplitNode, edge: SplitRootEdge): { tree: SplitNode; newSlot: number } {
  const used = new Set(leaves(node));
  let newSlot = 0;
  while (used.has(newSlot)) newSlot += 1;
  const leaf: SplitNode = { leaf: newSlot };
  return {
    newSlot,
    tree:
      edge === "top"
        ? { dir: "row", ratio: 0.5, a: leaf, b: node }
        : { dir: "col", ratio: 0.5, a: node, b: leaf },
  };
}

/** 把已有叶搬到整个主视图边缘；原位置由兄弟子树上位，槽内容不动。 */
export function moveLeafToRoot(node: SplitNode, slot: number, edge: SplitRootEdge): SplitNode {
  if ("leaf" in node || !leaves(node).includes(slot)) return node;
  if (edge === "top" && node.dir === "row" && "leaf" in node.a && node.a.leaf === slot) return node;
  if (edge === "right" && node.dir === "col" && "leaf" in node.b && node.b.leaf === slot) return node;
  const remaining = removeLeaf(node, slot);
  const leaf: SplitNode = { leaf: slot };
  return edge === "top"
    ? { dir: "row", ratio: 0.5, a: leaf, b: remaining }
    : { dir: "col", ratio: 0.5, a: remaining, b: leaf };
}

/** 关闭某叶:兄弟子树上位(tmux 收格语义);最后一叶不许关(返回原树,
 *  出口是退出分屏不是关光格子)。 */
export function removeLeaf(node: SplitNode, slot: number): SplitNode {
  if ("leaf" in node) return node;
  return (
    transformTree<SplitNode | null>(
      node,
      (leaf) => (leaf.leaf === slot ? null : leaf),
      (branch, a, b) => {
        if (a && b) return a === branch.a && b === branch.b ? branch : { ...branch, a, b };
        return a ?? b;
      },
    ) ?? node
  );
}

/** 交换两叶的槽位(拖格头换位;两叶都得在树上,否则原样返回)。 */
export function swapLeaves(node: SplitNode, x: number, y: number): SplitNode {
  const present = new Set(leaves(node));
  if (x === y || !present.has(x) || !present.has(y)) return node;
  return transformTree<SplitNode>(
    node,
    (leaf) => (leaf.leaf === x ? { leaf: y } : leaf.leaf === y ? { leaf: x } : leaf),
    (branch, a, b) => (a === branch.a && b === branch.b ? branch : { ...branch, a, b }),
  );
}

/** 形状等价(忽略比例):header 档位钮的按下态按它判——用户拖过比例的
 *  四格仍是"四格"。 */
export function sameShape(a: SplitNode, b: SplitNode): boolean {
  const pending: [SplitNode, SplitNode][] = [[a, b]];
  while (pending.length > 0) {
    const [left, right] = pending.pop()!;
    if ("leaf" in left || "leaf" in right) {
      if (!("leaf" in left && "leaf" in right && left.leaf === right.leaf)) return false;
      continue;
    }
    if (left.dir !== right.dir) return false;
    pending.push([left.a, right.a], [left.b, right.b]);
  }
  return true;
}
