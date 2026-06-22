import { IconBrandGithub, IconCloudCode, IconListDetails } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const modules = [
  {
    icon: IconListDetails,
    code: "MOD-01",
    key: "online",
  },
  {
    icon: IconCloudCode,
    code: "MOD-02",
    key: "cloud",
  },
  {
    icon: IconBrandGithub,
    code: "MOD-03",
    key: "open",
  },
];

const SDD = () => {
  const { t } = useTranslation();

  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20" id="sdd">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-slate-900 px-3 py-2 text-[10px] text-slate-50">
            CORE VALUE
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            {t("welcomeHome.sdd.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            {t("welcomeHome.sdd.description")}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {modules.map((module) => (
            <div
              key={module.code}
              className="pixel-panel-dark flex h-full flex-col gap-4 border-amber-300 bg-slate-950 px-6 py-6 text-white"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex size-11 items-center justify-center border-2 border-amber-300 bg-white/8 text-amber-200">
                  <module.icon className="size-5" />
                </div>
                <span className="font-pixel text-[10px] text-amber-200">{module.code}</span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight">{t(`welcomeHome.sdd.modules.${module.key}.title`)}</h3>
              <p className="text-sm leading-7 text-slate-300">{t(`welcomeHome.sdd.modules.${module.key}.description`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
};

export default SDD;
