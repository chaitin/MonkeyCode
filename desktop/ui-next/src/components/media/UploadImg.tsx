// 附件呈现(用户气泡与工具卡共用):壳异步回读的图片 + 文件落盘下载 +
// 大图 lightbox。设计移植旧 uploadMedia/logView,实现走 daisyUI modal。
import { useEffect, useState } from "react";

import { pushEscLayer } from "@/lib/util/escLayer";

/** 上传/落盘图片:src 经壳异步回读(data URL),就绪前不渲染——
 * 失败(越界路径/超限/日志清理)也不渲染,永不出裂图。 */
export function UploadImg({
  load,
  alt,
  title,
  onClick,
  className,
}: {
  load: () => Promise<string>;
  alt: string;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (u) => alive && setSrc(u),
      () => alive && setSrc(null),
    );
    return () => {
      alive = false;
    };
    // load 闭包按 alt(路径)稳定,不依赖函数身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alt]);
  if (!src) return null;
  return <img src={src} alt={alt} title={title} onClick={onClick} className={className} />;
}

/** 附件文件下载:壳回读 data URL 后经 <a download> 落盘;失败静默(路径
 * 越界/日志清理时壳侧拒绝,下载动作无处外显,与旧 UI 同口径)。 */
export function downloadUpload(load: () => Promise<string>, name: string): void {
  load()
    .then((url) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    })
    .catch(() => {});
}

/** 大图预览:daisyUI modal 官方形态;Esc 经 escLayer 层栈消费(浮层最后打开
 * 即在栈顶,先拿到这一下,也不会漏给全局审批热键——esc = deny 不可逆)。 */
export function Lightbox({ alt, onClose, children }: { alt: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    return pushEscLayer(() => {
      onClose();
      return true;
    });
    // onClose 由调用方保证稳定(setState);挂载期一次入栈即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal modal-open" role="dialog" aria-label={alt}>
      <div className="modal-box flex max-h-[88vh] w-auto max-w-[88vw] items-center justify-center p-2">
        {children}
      </div>
      <div className="modal-backdrop cursor-pointer" onClick={onClose} aria-hidden />
    </div>
  );
}
