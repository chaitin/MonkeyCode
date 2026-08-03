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

/** 大纲跳转后,目标气泡与日志视口顶部之间保留的呼吸空间。「当前项」判定
 * 必须使用同一条线,否则目标停在这条线时仍会把上一问标成当前(移植旧
 * outline.tsx,B10 大纲高亮/offset 补页消费)。 */
export const OUTLINE_JUMP_INSET = 12;

/** 视口当前所在的提问 = 视口顶线(含 INSET)之上最后一条条目的 seq;
 * 给布局的亚像素取整留 1px 余量,避免恰好对齐时来回跳。seqTops 按文档序
 * 传入;无命中(列表为空/全部还在顶线之下)回 null。 */
export function outlineActiveSeq(seqTops: Array<{ seq: number; top: number }>, viewportTop: number): number | null {
  let seq: number | null = null;
  for (const item of seqTops) {
    if (item.top - viewportTop > OUTLINE_JUMP_INSET + 1) break;
    seq = item.seq;
  }
  return seq;
}
