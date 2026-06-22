
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

const LINKS = [
  {
    titleKey: "welcomeShell.footer.resources",
    links: [
      {
        titleKey: "welcomeShell.footer.productDocs",
        href: "https://monkeycode.docs.baizhi.cloud/"
      },
      {
        titleKey: "welcomeShell.footer.forum",
        href: "https://bbs.baizhi.cloud/"
      },
      {
        titleKey: "welcomeShell.nav.openSourceRepo",
        href: "https://github.com/chaitin/MonkeyCode/"
      },
      {
        titleKey: "welcomeShell.footer.modelSquare",
        href: "https://baizhi.cloud/landing/model-square"
      }
    ]
  },
  {
    titleKey: "welcomeShell.footer.about",
    links: [
      {
        titleKey: "welcomeShell.footer.chaitin",
        href: "https://www.chaitin.cn/"
      },
      {
        titleKey: "welcomeShell.footer.baizhi",
        href: "https://www.baizhi.cloud/"
      },
      {
        titleKey: "welcomeShell.nav.privacyPolicy",
        href: "/privacy-policy"
      },
      {
        titleKey: "welcomeShell.nav.userAgreement",
        href: "/user-agreement"
      },
      {
        titleKey: "welcomeShell.footer.icp",
        href: "https://beian.miit.gov.cn/"
      }
    ]
  }
]

const Footer = () => {
  const { t } = useTranslation()

  return (
    <footer className="bg-primary px-10">
      <div className="flex flex-col lg:flex-row gap-10 lg:gap-0 justify-between mx-auto max-w-[1200px] py-10">
        <div className="flex flex-col gap-4">
          <h3 className="text-background flex flex-row items-center gap-4">
            <img src="/logo.png" className="size-8" />
            {t("welcomeShell.footer.brandTitle")}
          </h3>
          <p className="text-background/50 text-sm max-w-[350px]">
            {t("welcomeShell.footer.brandDescription")}
          </p>
        </div>
        {LINKS.map((link) => (
          <div key={link.titleKey} className="flex flex-col gap-4">
            <h3 className="text-background leading-8">{t(link.titleKey)}</h3>
            <ul className="text-background/50 text-sm flex flex-col gap-2">
              {link.links.map((link) => (
                <li key={link.titleKey}>
                  {link.href.startsWith("/") ? (
                    <Link to={link.href} className="flex items-center gap-2 hover:text-background">
                      {t(link.titleKey)}
                    </Link>
                  ) : (
                    <a href={link.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-background">
                      {t(link.titleKey)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="flex flex-col gap-4">
          <h3 className="text-background leading-8">{t("welcomeShell.footer.community")}</h3>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col items-center gap-2">
              <img src="/wechat.png" className="size-30 rounded-sm" alt={t("welcomeShell.community.wechatAlt")} />
              <span className="text-background/70 text-xs">{t("welcomeShell.community.wechat")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <img src="/feishu.png" className="size-30 rounded-sm" alt={t("welcomeShell.community.feishuAlt")} />
              <span className="text-background/70 text-xs">{t("welcomeShell.community.feishu")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <img src="/dingtalk.png" className="size-30 rounded-sm" alt={t("welcomeShell.community.dingtalkAlt")} />
              <span className="text-background/70 text-xs">{t("welcomeShell.community.dingtalk")}</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
};

export default Footer;
