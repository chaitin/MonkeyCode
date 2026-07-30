// 附件呈现:壳异步回读的图片渲染与文件落盘下载(工具卡与用户气泡共用)。
import { useEffect, useState, type CSSProperties } from "react";

/** 上传/落盘图片:src 经壳异步回读(data URL),就绪前占位不渲染。 */
export function UploadImg({
  load,
  alt,
  title,
  onClick,
  style,
}: {
  load: () => Promise<string>;
  alt: string;
  title?: string;
  onClick?: () => void;
  style?: CSSProperties;
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
  return <img src={src} alt={alt} title={title} onClick={onClick} style={style} />;
}

/** 附件文件下载:壳回读 data URL 后经 <a download> 落盘。 */
export function downloadUpload(load: () => Promise<string>, name: string): void {
  load().then((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }).catch(() => {});
}
