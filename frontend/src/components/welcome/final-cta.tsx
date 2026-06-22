import { Button } from "@/components/ui/button";
import { IconArrowRight, IconBook2, IconStack2 } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const FinalCTA = () => {
  const { t } = useTranslation();

  return (
    <section className="w-full px-6 pt-6 pb-16 sm:px-10 sm:pt-10 sm:pb-24">
      <div className="pixel-grid mx-auto max-w-[1200px] border-2 border-slate-900 bg-[linear-gradient(180deg,#fffaf0_0%,#fff3e0_100%)] px-6 py-10 shadow-[10px_10px_0_rgba(249,115,22,0.22)] sm:px-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-primary px-3 py-2 text-[10px] text-primary-foreground">
            START
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            {t("welcomeHome.finalCta.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            {t("welcomeHome.finalCta.description")}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="pixel-button h-12 border-slate-950 px-6" asChild>
              <Link to="/console">
                {t("welcomeHome.finalCta.actions.start")}
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" className="pixel-button h-12 border-slate-950 px-6 bg-white text-slate-900 hover:bg-slate-50" asChild>
              <a href="https://monkeycode.docs.baizhi.cloud/" target="_blank" rel="noreferrer">
                <IconBook2 className="size-4" />
                {t("welcomeHome.finalCta.actions.docs")}
              </a>
            </Button>
            <Button size="lg" variant="ghost" className="pixel-button h-12 border-slate-950 bg-amber-100 px-6 text-slate-900 hover:bg-amber-200" asChild>
              <Link to="/#pricing">
                <IconStack2 className="size-4" />
                {t("welcomeHome.finalCta.actions.pricing")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCTA;
