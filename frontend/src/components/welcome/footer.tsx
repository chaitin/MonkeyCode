
import { Link } from "react-router-dom"

const LINKS = [
  {
    title: "资源",
    links: [
      {
        title: "产品文档",
        href: "https://monkeycode.docs.baizhi.cloud/"
      },
      {
        title: "技术论坛",
        href: "https://bbs.baizhi.cloud/"
      },
      {
        title: "开源仓库",
        href: "https://github.com/chaitin/MonkeyCode/"
      },
      {
        title: "模型广场",
        href: "https://baizhi.cloud/landing/model-square"
      }
    ]
  },
  {
    title: "关于我们",
    links: [
      {
        title: "长亭科技",
        href: "https://www.chaitin.cn/"
      },
      {
        title: "长亭百智云",
        href: "https://www.baizhi.cloud/"
      },
      {
        title: "隐私政策",
        href: "/privacy-policy"
      },
      {
        title: "用户协议",
        href: "/user-agreement"
      },
      {
        title: "京ICP备2024055124号-12",
        href: "https://beian.miit.gov.cn/"
      }
    ]
  }
]

const Footer = () => {
  return (
    <footer className="bg-primary px-10">
      <div className="flex flex-col lg:flex-row gap-10 lg:gap-0 justify-between mx-auto max-w-[1200px] py-10">
        <div className="flex flex-col gap-4">
          <h3 className="text-background flex flex-row items-center gap-4">
            <img src="/logo.png" className="size-8" />
            MonkeyCode 智能开发平台
          </h3>
          <p className="text-background/50 text-sm max-w-[350px]">
          MonkeyCode 不是 AI 编程工具，是对传统研发模式的变革，是全新的 AI 编程体验，让你的研发团队效率 Max。
          </p>
        </div>
        {LINKS.map((link) => (
          <div key={link.title} className="flex flex-col gap-4">
            <h3 className="text-background leading-8">{link.title}</h3>
            <ul className="text-background/50 text-sm flex flex-col gap-2">
              {link.links.map((link) => (
                <li key={link.title}>
                  {link.href.startsWith("/") ? (
                    <Link to={link.href} className="flex items-center gap-2 hover:text-background">
                      {link.title}
                    </Link>
                  ) : (
                    <a href={link.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-background">
                      {link.title}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="flex flex-col gap-4">
          <h3 className="text-background leading-8">技术交流群</h3>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col items-center gap-2">
              <img src="/wechat.png" className="size-30 rounded-sm" alt="微信二维码" />
              <span className="text-background/70 text-xs">微信群</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <img src="/feishu.png" className="size-30 rounded-sm" alt="飞书群二维码" />
              <span className="text-background/70 text-xs">飞书群</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <img src="/dingtalk.png" className="size-30 rounded-sm" alt="钉钉群二维码" />
              <span className="text-background/70 text-xs">钉钉群</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
};

export default Footer;
