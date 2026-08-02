// 云端任务文件抽屉:经控制流(Control WS 内核代理)浏览 VM 工作区。
// 渲染整体复用共享 FilesDrawer(filesdrawer.tsx,与本地文件抽屉同一实现),
// 这里只做数据适配:repo_file_list / repo_read_file / repo_file_changes /
// repo_file_diff(与 web 控制台 task-file-explorer 同一套 kind 与字段),
// 差异是 base64 内容解码、entry_mode 判目录、读取上限与唤醒超时余量。
import { useEffect, useRef, useState } from "react";
import { connectCloudControl, mcFileUpload, WAKE_CALL_TIMEOUT_MS, type CloudControl } from "./cloudapi";
import { readDataURL } from "./cloudUpload";
import { startDownload } from "./downloads";
import { pickSaveFile } from "./host";
import type { CloudFileChange, CloudRepoFile } from "./types";
import { b64decode } from "./codec";
import { FilesDrawer, fmtSize, type FsAdapter } from "./filesdrawer";

const isDir = (f: CloudRepoFile) => f.entry_mode === 4 || f.entry_mode === 5;

const MAX_FILE_SIZE = 1 << 20; // 读取上限 1MB(对齐 web/mobile)

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 上传上限 10MB(对齐 web 控制台文件树)

/** 树内相对路径 → VM 内绝对路径(与 web 同一约定:工作区固定挂 /workspace) */
const vmPath = (dir: string, name: string) => "/workspace/" + (dir ? dir + "/" : "") + name;

// 控制流 call 默认 15s 超时,但拨号会触发休眠 VM 唤醒(以分钟计):
// 抽屉内所有调用给足唤醒余量,免得唤醒期间必然超时
const WAKE_CALL_OPTS = { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: "云端环境可能在唤醒中,响应超时,请稍后重试" };

export function CloudFilesDrawer({
  taskId,
  vmId,
  onClose,
}: {
  taskId: string;
  /** 任务 VM id(REST 文件上传按它寻址);空 = 无上传入口(VM 未就绪/已结束) */
  vmId?: string;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState<CloudFileChange[] | null>(null);
  const [ctrlErr, setCtrlErr] = useState("");
  const ctrlRef = useRef<CloudControl | null>(null);
  // 控制流连接惰性建立:FilesDrawer(子组件)挂载 effect 先于本组件 effect
  // 执行,根目录列取即首个触达点。连不上/反复断开时控制流会放弃自动重连
  // 并外显;之后任何操作(展开目录/看文件)经 call() 懒重连,不再无限拨号刷屏
  const ensureCtrl = () =>
    (ctrlRef.current ??= connectCloudControl(taskId, {
      onStatus: (text, ok) => {
        if (!ok) setCtrlErr(text);
      },
    }));

  // 拉改动(根目录由 FilesDrawer 挂载时经适配层拉取);上传后也重拉,
  // 新文件的「??」要能出现在改动徽标里
  const refreshChanges = () =>
    ensureCtrl()
      .call<{ changes?: CloudFileChange[] }>("repo_file_changes", {}, WAKE_CALL_OPTS)
      .then((r) => setChanges(r.changes ?? []))
      .catch(() => setChanges([]));

  // 打开即拉改动;卸载即断开
  useEffect(() => {
    void refreshChanges();
    return () => {
      ctrlRef.current?.close();
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const adapter: FsAdapter = {
    listDir: async (dir) => {
      const r = await ensureCtrl().call<{ files?: CloudRepoFile[] }>(
        "repo_file_list",
        { path: dir, glob_pattern: "*", include_hidden: true },
        WAKE_CALL_OPTS,
      );
      setCtrlErr(""); // 列表成功即清错(与共享件的 clearErrOnListSuccess 同一历史行为)
      return (r.files ?? [])
        .filter((f) => f.name !== ".git")
        .sort((a, b) => (isDir(b) ? 1 : 0) - (isDir(a) ? 1 : 0) || a.name.localeCompare(b.name))
        .map((f) => ({ name: f.name, path: f.path, isDir: isDir(f), size: f.size }));
    },
    readFile: async (en) => {
      if ((en.size ?? 0) > MAX_FILE_SIZE) return { plain: `文件较大(${fmtSize(en.size)}),请在网页控制台查看` };
      const r = await ensureCtrl().call<{ content?: string }>(
        "repo_read_file",
        { path: en.path, offset: 0, length: MAX_FILE_SIZE },
        WAKE_CALL_OPTS,
      );
      return { content: r.content ? b64decode(r.content) : "" };
    },
    diff: async (path) => {
      const r = await ensureCtrl().call<{ diff?: string }>(
        "repo_file_diff",
        { path, unified: true, context_lines: 20 },
        WAKE_CALL_OPTS,
      );
      return r.diff || "(无差异)";
    },
    diffTransientKind: "plain",
    clearErrOnListSuccess: true,
    // 上传/下载(REST 直达 VM,壳代理;与 web 控制台同一端点)。
    // 上传顺序进行、失败即止:已传成功的部分随抽屉强刷可见,错误在列表区外显
    ...(vmId
      ? {
          upload: async (dir: string, files: File[]) => {
            for (const f of files) {
              if (f.size === 0) throw new Error(`${f.name} 是空文件`);
              if (f.size > MAX_UPLOAD_SIZE) throw new Error(`${f.name} 过大(单文件上限 10MB)`);
              const dataURL = await readDataURL(f);
              await mcFileUpload(vmId, vmPath(dir, f.name), dataURL.slice(dataURL.indexOf(",") + 1));
            }
            void refreshChanges();
          },
          // 下载:原生「另存为」定位置后登记到全局下载管理即返回——进度/
          // 结果在右下角下载条外显,关抽屉/切页面不中断;目录服务端打 zip
          download: async (en: { path: string; name: string; isDir: boolean }) => {
            const filename = en.isDir ? en.name + ".zip" : en.name;
            const dest = await pickSaveFile(filename);
            if (!dest) return false; // 用户取消
            void startDownload({ vmId, vmPath: "/workspace/" + en.path, filename, dest });
            return true;
          },
        }
      : {}),
  };

  return (
    <FilesDrawer
      adapter={adapter}
      onClose={onClose}
      changes={changes}
      externalErr={ctrlErr}
      errPad="6px 20px 0"
      changesEmptyText="还没有文件改动"
      changesLoadingText="加载中…"
      viewerCloseTitle="关闭预览"
    />
  );
}
