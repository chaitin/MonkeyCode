import LegalTerminalPage from "@/components/welcome/legal-terminal-page";
import { useTranslation } from "react-i18next";
import { type LegalPageCopy, renderOfficialChannels, withContactFooter } from "./legal-page-i18n";

export default function UserAgreementPage() {
  const { t } = useTranslation();
  const page = t("legalPages.userAgreement", { returnObjects: true }) as LegalPageCopy;
  const sections = withContactFooter(page.sections, renderOfficialChannels(t, "legalPages.userAgreement.contact"));

  return (
    <LegalTerminalPage
      eyebrow={page.eyebrow}
      title={page.title}
      subtitle={page.subtitle}
      lastUpdated="2026-03-24"
      tags={page.tags}
      sections={sections}
    />
  );
}
