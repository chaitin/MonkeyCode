// 分屏状态机(App 持有,不在 SplitView 内):toast 点击路由与通知抑制
// 都要在渲染分支之外读槽位——状态放视图里,App 就得靠 ref 反向掏。
// 布局是一棵用户拆的二叉树(tree.ts;2026-08-16 终案「随便他搞」),
// 树与槽位分配经 effect 持久化(mc.splitTree/mc.splitSlots,prefs.ts);
// 放大与焦点是会话内瞬态,刻意不落盘。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readSplitSlots, readSplitTreeRaw, writeSplitSlots, writeSplitTree } from "@/lib/util/prefs";
import { assign, eject, ejectCloud, firstEmptyIn, isCloudSlotId, prune, seed, type Slots } from "./slots";
import {
  equalizeAt,
  insertEdgeLeaf,
  leaves,
  moveLeafToEdge,
  PRESETS,
  remapLeaves,
  removeLeaf,
  setRatio,
  splitLeaf,
  swapLeaves,
  validateTree,
  type SplitDir,
  type SplitEdge,
  type SplitNode,
} from "./tree";

export interface SplitStateApi {
  slots: Slots;
  tree: SplitNode;
  /** 放大(临时独占,tmux zoom 心智):非 null = 只展示该槽,树不变。 */
  zoomed: number | null;
  /** 焦点格:审批快捷键/composer 聚焦意图只路由到它(shortcuts.ts 头注)。 */
  focused: number;
  /** 实际在渲染的槽(放大 > 树叶集,阅读序);通知抑制按它算可见集。 */
  visibleIndices: readonly number[];
  /** 拖分隔线:按节点路径改比例(路径见 tree.setRatio)。 */
  setNodeRatio: (path: string, ratio: number) => void;
  /** 双击分隔线:让该节点辖下的所有格子尽量等面积,路径外不动。 */
  equalizeNode: (path: string) => void;
  /** 拆分某格(向右/向下):新格取最小空槽号并夺焦。 */
  splitPane: (slot: number, dir: SplitDir) => number | null;
  /** 左/右创建全局列，上/下在目标格的纵向组创建局部行。 */
  addEdgePane: (target: number, edge: SplitEdge) => number | null;
  /** 把已有格搬到目标边缘；原位置自动收拢。 */
  movePaneToEdge: (slot: number, target: number, edge: SplitEdge) => void;
  /** 关闭某格(tmux 收格:兄弟上位):槽位内容一并清档。若关闭最后
   *  一格则保留一个空宿主叶，并返回其槽号供调用方打开新建页。 */
  closePane: (slot: number) => number | null;
  /** 原子关闭承载指定条目的全部格；异常旧档出现重复条目时也一次收净。 */
  closeEntry: (entry: string) => number | null;
  /** 两格交换位置(拖格头换位;内容跟格走)。 */
  swapPanes: (x: number, y: number) => void;
  focus: (index: number) => void;
  toggleZoom: (index: number) => void;
  assignTo: (index: number, id: string) => void;
  ejectAt: (index: number) => void;
  /** MonkeyCode 服务/账号切换后清掉旧 transport 的云端任务槽。 */
  clearCloud: () => void;
  /** 首开播种(槽位全空时把当前会话带进首叶;见 slots.seed)。 */
  seedWith: (currentId: string | null) => void;
  /** 成功加载的会话全表剪枝(失败不许调,铁律见 slots.prune)。 */
  pruneTo: (alive: ReadonlySet<string>) => void;
  /** 屏外任务路由(toast/托盘点击):已在可见格 → 只夺焦;否则装进叶序
   *  第一个空格(无空格顶替焦点格)。放大态下切到目标槽独占。 */
  place: (id: string) => void;
}

function readInitialSplitState(): { tree: SplitNode; slots: Slots } {
  // 首启缺省**单格**(2026-08-20 用户定案:新用户开门见两栏、右栏空面板
  // 冷场;多格由拆分/「新建即新格」自然长出)。恢复时只取树实际引用的
  // 槽，并把异常稀疏的叶槽号压密：树形/视觉顺序不变，同时避免手改的超大
  // 叶号触发稠密数组扩容、离树长尾拖慢此后的每次渲染。
  const restoredTree = validateTree(readSplitTreeRaw()) ?? PRESETS["1"];
  const oldSlots = leaves(restoredTree).sort((a, b) => a - b);
  const restoredSlots = readSplitSlots(oldSlots);
  const maxSlot = oldSlots.at(-1) ?? 0;
  // 正常拆关形成的低位空洞保留编号（例如历史「第 7 格」）；只有槽号相对
  // 叶数异常稀疏时才压密。阈值随叶数增长，不构成 pane 数量上限。
  const compact = maxSlot > oldSlots.length * 8 + 1024;
  const remap = new Map(oldSlots.map((slot, index) => [slot, compact ? index : slot]));
  const tree = compact ? remapLeaves(restoredTree, remap) : restoredTree;
  const slots: (string | null)[] = [];
  oldSlots.forEach((slot, index) => {
    const target = remap.get(slot)!;
    const entry = restoredSlots[index] ?? null;
    if (entry) slots[target] = entry;
  });
  let length = slots.length;
  while (length > 0 && !slots[length - 1]) length -= 1;
  return { tree, slots: Array.from({ length }, (_, index) => slots[index] ?? null) };
}

export function useSplitState(): SplitStateApi {
  const [initial] = useState(readInitialSplitState);
  const [slots, setSlots] = useState<Slots>(initial.slots);
  const [tree, setTree] = useState<SplitNode>(initial.tree);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [focused, setFocused] = useState(() => leaves(initial.tree)[0] ?? 0);

  // 持久化走 effect 不进 setState 更新器(更新器要纯;挂载首拍回写读到的
  // 归一化档,幂等)
  useEffect(() => writeSplitSlots(slots), [slots]);
  useEffect(() => writeSplitTree(tree), [tree]);

  const visibleIndices = useMemo(() => (zoomed !== null ? [zoomed] : leaves(tree)), [zoomed, tree]);

  // place/事件路径经 ref 读最新快照(App 的监听只挂一次,闭包不攥旧状态
  // ——与 App.tsx sessionsRef 同款手法)
  const snapRef = useRef({ slots, tree, zoomed, focused });
  snapRef.current = { slots, tree, zoomed, focused };

  const setNodeRatio = useCallback((path: string, ratio: number) => {
    setTree((prev) => setRatio(prev, path, ratio));
  }, []);

  const equalizeNode = useCallback((path: string) => {
    setTree((prev) => equalizeAt(prev, path));
  }, []);

  const splitPane = useCallback((slot: number, dir: SplitDir): number | null => {
    const res = splitLeaf(snapRef.current.tree, slot, dir);
    if (!res) return null;
    setTree(res.tree);
    setZoomed(null); // 独占态下拆分 = 想看两个,展开
    setFocused(res.newSlot);
    // 新槽号回给调用方:「新建即新格」要把创建表单定点装进拆出来的格
    return res.newSlot;
  }, []);

  const addEdgePane = useCallback((target: number, edge: SplitEdge): number | null => {
    const res = insertEdgeLeaf(snapRef.current.tree, target, edge);
    if (!res) return null;
    setTree(res.tree);
    setZoomed(null);
    setFocused(res.newSlot);
    return res.newSlot;
  }, []);

  const movePaneToEdge = useCallback((slot: number, target: number, edge: SplitEdge) => {
    const next = moveLeafToEdge(snapRef.current.tree, slot, target, edge);
    setTree(next);
    setZoomed(null);
    setFocused(slot);
  }, []);

  const closePanes = useCallback((targets: ReadonlySet<number>): number | null => {
    const cur = snapRef.current;
    const order = leaves(cur.tree);
    const closing = order.filter((slot) => targets.has(slot));
    if (closing.length === 0) return null;

    const closingAll = closing.length === order.length;
    const host = closingAll ? (order[0] ?? 0) : null;
    let next: SplitNode = host === null ? cur.tree : { leaf: host };
    if (!closingAll) {
      for (const slot of closing) next = removeLeaf(next, slot);
    }
    setTree(next);
    setSlots((prev) => closing.reduce((slots, slot) => eject(slots, slot), prev));
    if (cur.zoomed !== null && targets.has(cur.zoomed)) setZoomed(null);
    setFocused((focused) => (targets.has(focused) ? (leaves(next)[0] ?? 0) : focused));
    return host;
  }, []);

  const closePane = useCallback((slot: number) => closePanes(new Set([slot])), [closePanes]);

  const closeEntry = useCallback(
    (entry: string) => {
      const cur = snapRef.current;
      return closePanes(new Set(leaves(cur.tree).filter((slot) => cur.slots[slot] === entry)));
    },
    [closePanes],
  );

  const swapPanes = useCallback((x: number, y: number) => {
    setTree((prev) => swapLeaves(prev, x, y));
    // swapLeaves 交换的是树上的叶位置，槽号 x 仍属于被拖内容；焦点应
    // 跟着它留在 x，而不是跳到 y（y 是目标旧内容）。
    setFocused(x);
  }, []);

  const focus = useCallback((index: number) => setFocused(index), []);

  const toggleZoom = useCallback((index: number) => {
    setZoomed((z) => (z === index ? null : index));
    setFocused(index);
  }, []);

  const assignTo = useCallback((index: number, id: string) => {
    setSlots((prev) => assign(prev, index, id));
    setFocused(index);
  }, []);

  const ejectAt = useCallback((index: number) => {
    setSlots((prev) => eject(prev, index));
  }, []);

  const clearCloud = useCallback(() => {
    const cur = snapRef.current;
    setSlots((prev) => ejectCloud(prev));
    // 放大的恰是旧云端槽时退出独占，否则清空后会把仍有效的本地格全藏住。
    if (cur.zoomed !== null) {
      const entry = cur.slots[cur.zoomed];
      if (entry && isCloudSlotId(entry)) setZoomed(null);
    }
  }, []);

  const seedWith = useCallback((currentId: string | null) => {
    const first = leaves(snapRef.current.tree)[0] ?? 0;
    setSlots((prev) => seed(prev, currentId, first));
  }, []);

  const pruneTo = useCallback((alive: ReadonlySet<string>) => {
    setSlots((prev) => prune(prev, alive));
  }, []);

  const place = useCallback((id: string) => {
    const cur = snapRef.current;
    const order = leaves(cur.tree);
    const existing = cur.slots.indexOf(id);
    let target: number;
    if (existing >= 0 && order.includes(existing)) {
      target = existing; // 已在树上(含被放大遮住的):夺焦/切独占即可
    } else {
      // 不在树上的异常/旧档槽视同不在场:assign 的 move 语义会把旧槽摘干净
      target = firstEmptyIn(cur.slots, order) ?? (order.includes(cur.focused) ? cur.focused : (order[0] ?? 0));
      setSlots((prev) => assign(prev, target, id));
    }
    if (cur.zoomed !== null) setZoomed(target);
    setFocused(target);
  }, []);

  return {
    slots,
    tree,
    zoomed,
    focused,
    visibleIndices,
    setNodeRatio,
    equalizeNode,
    splitPane,
    addEdgePane,
    movePaneToEdge,
    closePane,
    closeEntry,
    swapPanes,
    focus,
    toggleZoom,
    assignTo,
    ejectAt,
    clearCloud,
    seedWith,
    pruneTo,
    place,
  };
}
