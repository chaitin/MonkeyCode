import { cn } from "@/lib/utils";
import React from "react";
import { TerminalFooter, TerminalHeader } from "./terminal-chrome";

type LegalSection = {
  id: string;
  title: string;
  content?: string[];
  items?: string[];
  note?: string;
  footer?: React.ReactNode;
};

const themeVars = {
  "--a-bg": "#0a0d0a",
  "--a-bg-2": "#0d1210",
  "--a-panel": "#111814",
  "--a-line": "#1d2a22",
  "--a-line-2": "#243329",
  "--a-fg": "#c9d6cc",
  "--a-fg-dim": "#7a8c80",
  "--a-fg-mute": "#4a5b50",
  "--a-accent": "#7cf29c",
} as React.CSSProperties;

export default function LegalTerminalPage({
  eyebrow,
  title,
  subtitle,
  lastUpdated,
  tags,
  sections,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  lastUpdated: string;
  tags: string[];
  sections: LegalSection[];
}) {
  return (
    <div style={themeVars} className="min-h-screen bg-[var(--a-bg)] text-[var(--a-fg)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,242,156,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(97,218,251,0.08),transparent_22%),linear-gradient(180deg,#090c09_0%,#0b0f0c_48%,#0a0d0a_100%)]" />
      <TerminalHeader homeAnchors={false} />

      <main className="relative z-10 mx-auto max-w-[1280px] px-5 pb-12 pt-[108px] sm:px-8 sm:pb-16 sm:pt-[120px]">
        <section className="relative overflow-hidden rounded-[24px] border border-[var(--a-line-2)] bg-[linear-gradient(135deg,rgba(17,24,20,0.98),rgba(13,18,16,0.95))] p-7 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] sm:p-10">
          <div className="pointer-events-none absolute right-[-60px] top-[-80px] h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(124,242,156,0.14),transparent_70%)] blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center rounded-full border border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.08)] px-3 py-1 text-[11px] tracking-[0.12em] text-[var(--a-accent)]">
              {eyebrow}
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-5xl lg:text-[60px]">{title}</h1>
            <p className="mt-5 max-w-[820px] text-sm leading-8 text-[var(--a-fg-dim)] sm:text-[15px]">{subtitle}</p>
            <div className="mt-7 flex flex-wrap gap-3 text-[11px] tracking-[0.06em] text-[var(--a-fg-dim)]">
              <span className="rounded border border-[var(--a-line-2)] bg-[var(--a-panel)] px-3 py-2">最近更新：{lastUpdated}</span>
              {tags.map((tag) => (
                <span key={tag} className="rounded border border-[var(--a-line-2)] bg-[var(--a-panel)] px-3 py-2">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="h-fit rounded-[20px] border border-[var(--a-line)] bg-[var(--a-panel)] p-5 lg:sticky lg:top-24">
            <div className="text-[11px] tracking-[0.12em] text-[var(--a-accent)]"># 目录</div>
            <nav className="mt-4 space-y-1">
              {sections.map((section, index) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="flex items-start gap-3 rounded-[10px] px-3 py-2 text-sm text-[var(--a-fg-dim)] transition-colors hover:bg-[rgba(124,242,156,0.05)] hover:text-[var(--a-fg)]"
                >
                  <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-[var(--a-line-2)] text-[10px] text-[var(--a-accent)]">
                    {index + 1}
                  </span>
                  <span>{section.title}</span>
                </a>
              ))}
            </nav>
          </aside>

          <article className="rounded-[20px] border border-[var(--a-line)] bg-[var(--a-panel)] p-6 sm:p-8">
            {sections.map((section, index) => (
              <section
                id={section.id}
                key={section.id}
                className={cn(index === 0 ? "" : "mt-8 border-t border-[var(--a-line)] pt-8")}
              >
                <div className="inline-flex items-center rounded-full border border-[rgba(124,242,156,0.16)] bg-[rgba(124,242,156,0.06)] px-3 py-1 text-[11px] tracking-[0.12em] text-[var(--a-accent)]">
                  Section {String(index + 1).padStart(2, "0")}
                </div>
                <h2 className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-white">{section.title}</h2>
                {section.content?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-[15px] leading-8 text-[var(--a-fg-dim)]">
                    {paragraph}
                  </p>
                ))}
                {section.items ? (
                  <ul className="mt-5 space-y-3">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-3 text-[15px] leading-8 text-[var(--a-fg-dim)]">
                        <span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-[var(--a-accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.note ? (
                  <div className="mt-5 rounded-[16px] border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-5 py-4 text-[15px] leading-8 text-[var(--a-fg-dim)]">
                    {section.note}
                  </div>
                ) : null}
                {section.footer ? <div className="mt-4 text-[15px] leading-8 text-[var(--a-fg-dim)]">{section.footer}</div> : null}
              </section>
            ))}
          </article>
        </section>
      </main>

      <TerminalFooter />
    </div>
  );
}

export type { LegalSection };
