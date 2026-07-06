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

export function renderOfficialChannels(t: TFunction, keyPrefix: string, isGlobalRegion: boolean) {
  const channels = isGlobalRegion ? {
    primaryHref: "https://www.cyberserval.com/",
    primaryKey: "cyberserval",
    secondaryHref: "https://cyberserval.tech",
    secondaryKey: "safelineWaf",
  } : {
    primaryHref: "https://www.chaitin.cn/",
    primaryKey: "chaitin",
    secondaryHref: "https://www.baizhi.cloud/",
    secondaryKey: "baizhi",
  };

  return (
    <>
      {t(`${keyPrefix}.prefix`)}
      <a className="text-[var(--a-accent)] hover:underline" href={channels.primaryHref} target="_blank" rel="noreferrer">
        {t(`${keyPrefix}.${channels.primaryKey}`)}
      </a>
      {t(`${keyPrefix}.or`)}
      <a className="text-[var(--a-accent)] hover:underline" href={channels.secondaryHref} target="_blank" rel="noreferrer">
        {t(`${keyPrefix}.${channels.secondaryKey}`)}
      </a>
      {t(`${keyPrefix}.suffix`)}
    </>
  );
}
