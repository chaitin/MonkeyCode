import { ButtonLink } from "@/components/ui/button"
import { OnlineExperienceButton } from "@/components/OnlineExperienceButton"

export function HeaderActions() {
  return (
    <nav className="header-actions" aria-label="快捷入口">
      <ButtonLink variant="outline" className="header-github"
        href="https://github.com/chaitin/monkeycode"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub 源码"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.14c-3.2.69-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.97 10.97 0 0 1 5.75 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.42.36.78 1.06.78 2.14v3.15c0 .3.21.67.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
        <span className="header-github-label">GitHub</span>
      </ButtonLink>
      <OnlineExperienceButton className="header-online" />
    </nav>
  )
}
