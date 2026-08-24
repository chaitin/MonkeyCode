import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface McTransportGuard {
  /** 壳侧 MonkeyCode 服务地址/Basic Auth 的代次。 */
  generation: number;
  /** 异步操作完成时用它判断结果是否仍属于当前 transport。 */
  isCurrent: (generation: number) => boolean;
}

const FALLBACK: McTransportGuard = {
  generation: 0,
  // 独立组件测试和浏览器只读模式没有壳侧切服事件,结果始终可用。
  isCurrent: () => true,
};

const McTransportContext = createContext<McTransportGuard>(FALLBACK);

export function McTransportProvider({
  generation,
  isCurrent,
  children,
}: McTransportGuard & { children: ReactNode }) {
  const value = useMemo(() => ({ generation, isCurrent }), [generation, isCurrent]);
  return (
    <McTransportContext.Provider value={value}>
      {children}
    </McTransportContext.Provider>
  );
}

export const useMcTransport = () => useContext(McTransportContext);
