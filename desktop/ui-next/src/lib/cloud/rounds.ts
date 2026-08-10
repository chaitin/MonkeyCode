// 云端 rounds 批次的时序归一。服务端 backward 翻页契约(backend
// pkg/tasklog/clickhouse_provider.go QueryTurns 头注):**轮间倒序(最新轮
// 在前)、轮内正序**——一批多轮直接前插会把轮的顺序插反。「加载更早」
// 1 轮/页踩不中,大纲跳转 10 轮/页必踩(2026-08-06 用户报障「乱序」)。
// 轮与轮在时间上不重叠、轮内本就按 ts 正序(服务端 ORDER BY ts ASC),
// 按毫秒时间戳**稳定**排序即可恢复全局时序:轮内同 ms 的帧靠稳定性保序,
// 服务端触达最老一轮时注入的首条 user-input(ts=任务创建时刻)也自然归位。
import type { Frame } from "@/lib/protocol/types";

/** rounds 响应帧 → 时间正序(稳定排序,幂等;单轮批次是无害恒等)。 */
export function chronoRounds(frames: readonly Frame[]): Frame[] {
  return [...frames].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
