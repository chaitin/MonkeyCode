import { AuthProvider } from "@/components/auth-provider";
import LegalTerminalPage from "@/components/welcome/legal-terminal-page";
import { useTranslation } from "react-i18next";
import { type LegalPageCopy, renderOfficialChannels, withContactFooter } from "./legal-page-i18n";

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();
  const page = t("legalPages.privacy", { returnObjects: true }) as LegalPageCopy;
  const sections = withContactFooter(page.sections, renderOfficialChannels(t, "legalPages.privacy.contact"));

  return (
    <AuthProvider>
      <LegalTerminalPage
        eyebrow={page.eyebrow}
        title={page.title}
        subtitle={page.subtitle}
        lastUpdated="2026-03-24"
        tags={page.tags}
        sections={sections}
      />
    </AuthProvider>
  );
}
