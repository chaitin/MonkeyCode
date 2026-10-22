import { useRef, useState } from "react"
import { ArrowUpRight, Download, MonitorPlay, Settings2, X } from "lucide-react"
import { Dialog } from "radix-ui"
import { ClipboardFeedback, useClipboardFeedback } from "@/components/ClipboardFeedback"
import { Button, ButtonLink, type ButtonProps } from "@/components/ui/button"
import "@/styles/online-experience.css"

const demoServerURL = "https://demo.work.baizhi.cloud/"
const demoAdminURL = "https://admin.demo.work.baizhi.cloud/"
const downloadsURL = `${import.meta.env.BASE_URL}#clients`

type Props = Pick<ButtonProps, "size" | "className">
type CopyFieldProps = {
  label: string
  value: string
  onCopy: (value: string, label: string, field: HTMLElement) => Promise<boolean>
}

function CopyField({ label, value, onCopy }: CopyFieldProps) {
  return (
    <code role="button" tabIndex={0} className="experience-copy-field"
      aria-label={`复制${label}：${value}`}
      onClick={(event) => { void onCopy(value, label, event.currentTarget) }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        if (!event.repeat) void onCopy(value, label, event.currentTarget)
      }}>
      {value}
    </code>
  )
}

export function OnlineExperienceButton({ size = "md", className }: Props) {
  const [open, setOpen] = useState(false)
  const feedback = useClipboardFeedback()
  const copyField = feedback.copyText
  const focusDownloads = useRef(false)

  return (
    <ClipboardFeedback feedback={feedback}>
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (!nextOpen) feedback.dismiss()
    }}>
      <Dialog.Trigger asChild>
        <Button size={size} className={className}>
          <MonitorPlay aria-hidden="true" />
          <span>在线体验</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="experience-overlay" />
        <Dialog.Content className="experience-dialog" aria-describedby={undefined} onCloseAutoFocus={(event) => {
          if (!focusDownloads.current) return
          focusDownloads.current = false
          const downloads = document.getElementById("clients")
          if (!downloads) return
          event.preventDefault()
          requestAnimationFrame(() => {
            downloads.scrollIntoView({ block: "start" })
            downloads.focus({ preventScroll: true })
          })
        }}>
          <div className="experience-heading">
            <Dialog.Title className="experience-title">在线体验百智办公</Dialog.Title>
          </div>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="experience-close" aria-label="关闭在线体验对话框">
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
          <div className="experience-options">
            <section className="experience-option">
              <div className="experience-option-heading">
                <span className="experience-option-icon"><Download aria-hidden="true" /></span>
                <h3>体验客户端</h3>
              </div>
              <ol className="experience-steps">
                <li>
                  <div className="experience-step-heading">
                    <span className="experience-step-number" aria-hidden="true">1</span>
                    <h4>下载客户端</h4>
                  </div>
                  <Dialog.Close asChild>
                    <ButtonLink href={downloadsURL} variant="outline" className="experience-step-download" onClick={() => { focusDownloads.current = true }}>
                      <Download aria-hidden="true" />
                      <span>下载客户端</span>
                    </ButtonLink>
                  </Dialog.Close>
                </li>
                <li>
                  <div className="experience-step-heading">
                    <span className="experience-step-number" aria-hidden="true">2</span>
                    <h4>登录演示服务器</h4>
                  </div>
                  <div className="experience-server">
                    <span className="experience-server-label">演示服务器地址</span>
                    <div className="experience-server-address">
                      <CopyField label="演示服务器地址" value={demoServerURL} onCopy={copyField} />
                    </div>
                  </div>
                  <p className="experience-login-note">使用客户端连接上方服务器，通过邮箱接收验证码登录。</p>
                </li>
              </ol>
            </section>
            <section className="experience-option">
              <div className="experience-option-heading">
                <span className="experience-option-icon"><Settings2 aria-hidden="true" /></span>
                <h3>体验管理后台</h3>
              </div>
              <div className="experience-server experience-admin-server">
                <span className="experience-server-label">管理后台地址</span>
                <div className="experience-server-address">
                  <CopyField label="管理后台地址" value={demoAdminURL} onCopy={copyField} />
                </div>
              </div>
              <dl className="experience-account">
                <div><dt>账号</dt><dd><CopyField label="账号" value="admin@baizhi.cloud" onCopy={copyField} /></dd></div>
                <div><dt>密码</dt><dd><CopyField label="密码" value="work.baizhi.cloud" onCopy={copyField} /></dd></div>
              </dl>
              <ButtonLink href={demoAdminURL} target="_blank" rel="noopener noreferrer" variant="outline" className="experience-option-action">
                <span>查看管理后台</span>
                <ArrowUpRight aria-hidden="true" />
              </ButtonLink>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </ClipboardFeedback>
  )
}
