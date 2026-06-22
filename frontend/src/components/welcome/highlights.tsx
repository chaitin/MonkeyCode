import { IconBolt, IconCloudCode, IconPlugConnectedX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const items = [
  {
    icon: IconBolt,
    index: "01",
    key: "free",
  },
  {
    icon: IconCloudCode,
    index: "02",
    key: "cloud",
  },
  {
    icon: IconPlugConnectedX,
    index: "03",
    key: "noLocal",
  },
];

const Highlights = () => {
  const { t } = useTranslation();

  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
            WHY MONKEYCODE
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            {t("welcomeHome.highlights.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            {t("welcomeHome.highlights.description")}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.key}
              className="pixel-panel pixel-grid flex h-full flex-col gap-4 border-slate-900 bg-white px-6 py-6 transition-transform duration-200 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex size-11 items-center justify-center border-2 border-slate-900 bg-primary/12 text-primary">
                  <item.icon className="size-5" />
                </div>
                <span className="font-pixel text-[10px] text-slate-500">ERR-{item.index}</span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-slate-950">{t(`welcomeHome.highlights.items.${item.key}.title`)}</h3>
              <p className="text-sm leading-7 text-slate-600">{t(`welcomeHome.highlights.items.${item.key}.description`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Highlights;
