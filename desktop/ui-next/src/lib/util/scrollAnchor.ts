// 滚动锚点纯函数层(ChatView 消费):jsdom 验不了滚动几何,所有可测逻辑
// 压到这里,视图层只做 DOM 测量与 scrollTop 赋值。
//
// 为什么记「视口顶条目序号 + 条目内偏移」而不是 scrollTop 像素:历史分批
// 回放、工具结果合并进先前条目、折叠态重置都会改变上方内容高度,像素值
// 会漂,锚点跟着条目走才对得上「看到哪了」(旧 UI chat.tsx scrollMemo
// 的设计结论,随迁保留)。

/** 保存锚点:给定各条目相对滚动内容的 top 序列与当前 scrollTop,选出
 * 视口顶所在的条目及条目内已滚过的偏移。选择逻辑对齐旧 saveAnchor:
 * 第一个「底边」仍在视口顶之下的条目(条目底边以下一条的 top 近似;
 * 末条视为延伸到内容末尾)。空列表回零锚。 */
export function findAnchor(tops: number[], viewportTop: number): { anchor: number; offset: number } {
  for (let i = 0; i < tops.length; i++) {
    const bottom = i + 1 < tops.length ? tops[i + 1]! : Infinity;
    if (bottom > viewportTop) return { anchor: i, offset: viewportTop - tops[i]! };
  }
  return { anchor: 0, offset: 0 };
}

/** 恢复锚点:反算 scrollTop。anchor 越界钳制到现有条目范围(历史分批
 * 回放、锚点条目还没物化齐时先对到最后一条),结果不小于 0(offset 为
 * 负也不许把容器滚出上边界)。 */
export function anchorScrollTop(tops: number[], anchor: number, offset: number): number {
  if (tops.length === 0) return 0;
  const i = Math.min(Math.max(anchor, 0), tops.length - 1);
  return Math.max(0, tops[i]! + offset);
}

// ==== 程序性滚动标记 ====
// 贴底跟随的解除必须认得「用户向上滚」,但 scroll 事件不带来源:align 贴底、
// 动态行高锚点补偿、markdown 升格补偿、锚点恢复都会改 scrollTop。
// 凡代码写 scrollTop 都在**写入后**记下落点,onScroll 拿事件时刻的位置对表:
// 仍停在程序落点(±2px)= 程序滚动;偏离了 = 用户已接管。按落点对表而不是
// 计数:浏览器会把连发的程序写合并成一个事件,计数必然残留,残留会把之后
// 真正的用户滚动误判成程序滚(2026-08-11 切会话恢复位置报障的教训)。
const progTargets = new WeakMap<Element, number>();

/** 程序写 scrollTop **之后**调用:记录本次写入的实际落点(clamp 后值)。 */
export function markProgrammaticScroll(el: Element) {
  progTargets.set(el, (el as HTMLElement).scrollTop);
}

/** onScroll 查询:当前位置仍在最近一次程序落点上(±2px 容布局微调)则视为
 * 程序滚动;一旦偏离即清除标记,后续事件都按用户滚动处理。 */
export function consumeProgrammaticScroll(el: Element): boolean {
  const target = progTargets.get(el);
  if (target === undefined) return false;
  if (Math.abs((el as HTMLElement).scrollTop - target) <= 2) return true;
  progTargets.delete(el);
  return false;
}

/** 大纲跳转后,目标气泡与日志视口顶部之间保留的呼吸空间。「当前项」判定
 * 必须使用同一条线,否则目标停在这条线时仍会把上一问标成当前(移植旧
 * outline.tsx,B10 大纲高亮/offset 补页消费)。 */
export const OUTLINE_JUMP_INSET = 12;

/** 视口当前所在的提问 = 视口顶线(含 INSET)之上最后一条条目的 seq;
 * 给布局的亚像素取整留 1px 余量,避免恰好对齐时来回跳。seqTops 按文档序
 * 传入;若首条因容器内边距/顶部控件仍在顶线之下,它就是当前项;仅空列表
 * 回 null。 */
export function outlineActiveSeq(seqTops: Array<{ seq: number; top: number }>, viewportTop: number): number | null {
  let seq: number | null = null;
  for (const item of seqTops) {
    if (item.top - viewportTop > OUTLINE_JUMP_INSET + 1) break;
    seq = item.seq;
  }
  return seq ?? seqTops[0]?.seq ?? null;
}
