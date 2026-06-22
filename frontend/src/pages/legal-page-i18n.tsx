import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import type { LegalSection } from "@/components/welcome/legal-terminal-page";

export type LegalPageCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  tags: string[];
  sections: Array<Omit<LegalSection, "footer">>;
};

export function withContactFooter(
  sections: Array<Omit<LegalSection, "footer">>,
  footer: ReactNode
): LegalSection[] {
  return sections.map((section) => (section.id === "contact" ? { ...section, footer } : section));
}

export function renderOfficialChannels(t: TFunction, keyPrefix: string) {
  return (
    <>
      {t(`${keyPrefix}.prefix`)}
      <a className="text-[var(--a-accent)] hover:underline" href="https://www.chaitin.cn/" target="_blank" rel="noreferrer">
        {t(`${keyPrefix}.chaitin`)}
      </a>
      {t(`${keyPrefix}.or`)}
      <a className="text-[var(--a-accent)] hover:underline" href="https://www.baizhi.cloud/" target="_blank" rel="noreferrer">
        {t(`${keyPrefix}.baizhi`)}
      </a>
      {t(`${keyPrefix}.suffix`)}
    </>
  );
}
