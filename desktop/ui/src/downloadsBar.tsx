// 右下角全局下载条(类浏览器):进度、取消、完成定位、失败原因。数据在
// downloads.ts 的应用级 store——关文件抽屉/切页面不影响展示。进度形态
// 降级:有 Content-Length 显示百分比进度条,没有(目录 zip 流式打包)
// 显示已下载字节 + 呼吸动画。
import { cancelDownload, dismissDownload, useDownloads, type DownloadItem } from "./downloads";
import { fmtSize } from "./filesdrawer";
import { IconCheck, IconFolder, IconX } from "./icons";
import { invoke } from "./ipc";

/** 在系统文件管理器中定位已保存的文件。opener 插件的命令签名是
 * `reveal_item_in_dir(paths: Vec<PathBuf>)`——参数名必须是 paths 数组,
 * 传 {path} 会反序列化失败且无声(踩过);失败留 console 便于诊断,
 * 路径本身就在卡片上,用户仍可自寻。 */
const revealDest = (path: string) => {
  void invoke("plugin:opener|reveal_item_in_dir", { paths: [path] }).catch((e) => {
    console.error("[downloads] 文件管理器定位失败:", e);
  });
};

function ProgressTrack({ it }: { it: DownloadItem }) {
  const pct = it.total && it.total > 0 ? Math.min(100, (it.written / it.total) * 100) : null;
  return (
    <span style={{ display: "block", height: 4, borderRadius: 2, background: "var(--hov2)", overflow: "hidden" }}>
      <span
        style={{
          display: "block",
          height: "100%",
          borderRadius: 2,
          background: "var(--acc)",
          // 总量未知:进度条整条呼吸,宽度不撒谎
          width: pct !== null ? `${pct}%` : "100%",
          animation: pct !== null ? undefined : "mcpulse 1.6s ease-in-out infinite",
          transition: "width .2s ease",
        }}
      />
    </span>
  );
}

function DownloadCard({ it }: { it: DownloadItem }) {
  const pct = it.total && it.total > 0 ? Math.round((it.written / it.total) * 100) : null;
  return (
    <div
      style={{
        width: 280,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "9px 11px",
        borderRadius: 10,
        border: "1px solid var(--line)",
        background: "var(--pop)",
        boxShadow: "var(--shadow)",
        animation: "mcin .2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {it.status === "done" && <IconCheck size={11} />}
        <span className="ellipsis" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--t1)" }} title={it.filename}>
          {it.filename}
        </span>
        {it.status === "done" && (
          <button className="hv2 icon-btn" title="在文件管理器中显示" onClick={() => revealDest(it.dest)} style={{ width: 20, height: 20, borderRadius: 5 }}>
            <IconFolder size={12} color="var(--t3)" />
          </button>
        )}
        <button
          className="hv2 icon-btn"
          title={it.status === "running" ? "取消下载" : "关闭"}
          onClick={() => (it.status === "running" ? cancelDownload(it.id) : dismissDownload(it.id))}
          style={{ width: 20, height: 20, borderRadius: 5 }}
        >
          <IconX size={9} color="var(--t4)" />
        </button>
      </div>
      {it.status === "running" && (
        <>
          <ProgressTrack it={it} />
          <span style={{ fontSize: 11, color: "var(--t5)" }}>
            {pct !== null ? `${pct}% · ${fmtSize(it.written)} / ${fmtSize(it.total!)}` : `已下载 ${fmtSize(it.written)}`}
          </span>
        </>
      )}
      {it.status === "done" && (
        <span className="ellipsis" style={{ fontSize: 11, color: "var(--t5)" }} title={it.dest}>
          已保存到 {it.dest}
        </span>
      )}
      {it.status === "error" && (
        <span style={{ fontSize: 11, color: "var(--err)", wordBreak: "break-word" }}>✗ {it.error || "下载失败"}</span>
      )}
    </div>
  );
}

/** 挂在 App 根:无下载时不渲染任何 DOM。 */
export function DownloadsBar() {
  const items = useDownloads();
  if (items.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 80, // 压在文件抽屉(36)/缩放浮层(50)之上,下载去向任何页面都可见
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {items.map((it) => (
        <DownloadCard key={it.id} it={it} />
      ))}
    </div>
  );
}
