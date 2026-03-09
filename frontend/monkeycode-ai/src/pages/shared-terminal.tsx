import Terminal from "@/components/common/terminal"
import { Separator } from "@/components/ui/separator"
import { IconTerminal2, IconXboxXFilled } from "@tabler/icons-react"
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import themes from '@/utils/terminalThemes';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export default function SharedTerminalPage() {
  const [searchParams] = useSearchParams()
  const [connectionId] = useState<string | null>(searchParams.get('id'))
  const [title, setTitle] = useState<string>('Terminal')
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connected')
  const [password, setPassword] = useState<string>('')
  const [signal, setSignal] = useState<number>(0)
  const [showPasswordDialog, setShowPasswordDialog] = useState<boolean>(true)
  const [userName, setUserName] = useState<string>('')
  const [userAvatar, setUserAvatar] = useState<string>('')

  const [currentTheme, setCurrentTheme] = useState(() => {
    const savedTheme = localStorage.getItem('terminalTheme');
    return savedTheme ? savedTheme : 'MonkeyCode';
  });


  const renderTitle = () => {
    if (signal) {
      if (connectionStatus === 'connecting') {
        return <>
          <Spinner className="w-4 h-4 min-w-4 min-h-4 animate-spin" />
          正在连接
        </>
      } else if (connectionStatus === 'disconnected') {
        return <>
          <IconXboxXFilled className="w-4 h-4 min-w-4 min-h-4 text-red-500" />
          连接已断开
        </>
      } else if (connectionStatus === 'connected') {
        return <>
          <IconTerminal2 className="w-4 h-4 min-w-4 min-h-4" />
          {title}
        </>
      }
    }
    return <>
      <IconTerminal2 className="w-4 h-4 min-w-4 min-h-4" />
      连接未建立
    </>
  }

  const connect = () => {
    setShowPasswordDialog(false)
    setSignal(signal + 1)
  }

  return (
    <div className="flex flex-col h-screen">
      <Dialog open={showPasswordDialog} modal={true}>
        <DialogContent 
          showCloseButton={false} 
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>输入连接密码</DialogTitle>
          </DialogHeader>
          <Input
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password.trim()) {
                connect()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={connect} disabled={!password.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center gap-2">
          远程协助{userName && userAvatar && <>
            <span>-</span>
            来自
            <Avatar className="size-6">
              <AvatarFallback>
                <img src={userAvatar} className="size-4" />
              </AvatarFallback>
            </Avatar>
            {userName} 的分享
          </>}
        </div>
        {/*<ModeToggle />*/}
      </div>
      <div className="flex-1 p-2 pt-0 flex flex-col">
        <div className="flex flex-col flex-1 border rounded-lg overflow-hidden">
          <div className="flex justify-between items-center p-2">
            <div className="flex items-center gap-1 border rounded-md py-1.5 px-2 text-sm truncate max-w-[300px]">
              {renderTitle()}
            </div>
            <div className="flex items-center gap-2">
              <Select value={currentTheme} onValueChange={(value) => {
                setCurrentTheme(value);
                localStorage.setItem('terminalTheme', value);
              }}>
                <SelectTrigger className="w-[150px] hidden md:flex" size="sm">
                  <SelectValue placeholder="配色方案" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>配色方案</SelectLabel>
                    {Object.keys(themes).map((theme) => (
                      <SelectItem key={theme} value={theme}>{themes[theme as keyof typeof themes].name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="block h-full w-full overflow-hidden">
            <Terminal
              ws={password ? `/api/v1/users/hosts/vms/terminals/join?terminal_id=${connectionId}&password=${password}` : ''} 
              theme={currentTheme}
              signal={signal}
              onTitleChanged={setTitle}
              onUserNameChanged={(name, avatar) => {
                setUserName(name);
                setUserAvatar(avatar);
              }}
              onConnectionStatusChanged={(status) => {
                setConnectionStatus(status);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}