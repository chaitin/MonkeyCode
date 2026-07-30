// 设置界面共享的表单原语(settings.tsx 与 baizhi.tsx 共用,独立成文件避免循环导入)。
// 数值取自设计稿 Settings 屏。
import type { CSSProperties, ReactNode } from "react";
import { MONO } from "./components";

export const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "var(--t4)",
};

export const input: CSSProperties = {
  width: "100%",
  height: 30,
  border: "1px solid var(--inputBd)",
  borderRadius: 7,
  background: "var(--inputBg)",
  color: "var(--t1)",
  padding: "0 10px",
  fontSize: 12,
  fontFamily: MONO,
  outline: "none",
  minWidth: 0,
};

export const select: CSSProperties = {
  width: "100%",
  height: 30,
  border: "1px solid var(--inputBd)",
  borderRadius: 7,
  background: "var(--inputBg)",
  color: "var(--t1)",
  padding: "0 6px",
  fontSize: 12,
  outline: "none",
  cursor: "pointer",
};

export const whiteBtn: CSSProperties = {
  height: 28,
  border: "1px solid var(--btnBd)",
  background: "var(--card)",
  color: "var(--t1)",
  borderRadius: 8,
  padding: "0 13px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 5,
  boxShadow: "var(--cardSh)",
  whiteSpace: "nowrap",
};

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, color: "var(--t3)", fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}

export function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={sectionLabel}>{label}</span>
        <span style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}
