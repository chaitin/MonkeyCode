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
  leaves,
  PRESETS,
  removeLeaf,
  setRatio,
  splitLeaf,
  swapLeaves,
  validateTree,
  type SplitDir,
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
  /** 套模板(树整棵替换;树上不在场的槽位留档,换回即恢复)。 */
  /** 拖分隔线:按节点路径改比例(路径见 tree.setRatio)。 */
  setNodeRatio: (path: string, ratio: number) => void;
  /** 双击分隔线:让该节点辖下的所有格子尽量等面积,路径外不动。 */
  equalizeNode: (path: string) => void;
  /** 拆分某格(向右/向下):新格取最小空槽号并夺焦;到上限静默不动
   *  (按钮侧按 canSplit 置灰,这里只兜底)。 */
  splitPane: (slot: number, dir: SplitDir) => number | null;
  /** 关闭某格(tmux 收格:兄弟上位):槽位内容一并清档——关格是显式
   *  动作,不同于换模板的"藏而不清";最后一格不许关。 */
  closePane: (slot: number) => void;
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

export function useSplitState(): SplitStateApi {
  const [slots, setSlots] = useState<Slots>(readSplitSlots);
  // 首启缺省**单格**(2026-08-20 用户定案:新用户开门见两栏、右栏空面板
  // 冷场;多格由拆分/「新建即新格」自然长出)。存过树的老用户不受影响
  const [tree, setTree] = useState<SplitNode>(() => validateTree(readSplitTreeRaw()) ?? PRESETS["1"]);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [focused, setFocused] = useState(() => leaves(validateTree(readSplitTreeRaw()) ?? PRESETS["1"])[0] ?? 0);

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

  const closePane = useCallback((slot: number) => {
    const cur = snapRef.current;
    const next = removeLeaf(cur.tree, slot);
    if (next === cur.tree) return; // 最后一格/不在树上
    setTree(next);
    setSlots((prev) => eject(prev, slot));
    if (cur.zoomed === slot) setZoomed(null);
    setFocused((f) => (f === slot ? (leaves(next)[0] ?? 0) : f));
  }, []);

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
      // 不在树上的留档槽视同不在场:assign 的 move 语义会把旧槽摘干净
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
    closePane,
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
