import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import React from "react"
import { toast } from "sonner"
import { apiRequest } from "@/utils/requestUtils"
import { Link, useNavigate } from "react-router-dom"
import { captchaChallenge } from "@/utils/common"
import { Eye, EyeOff } from "lucide-react"

const USER_STORAGE_KEY = 'login_user'
const MANAGER_STORAGE_KEY = 'login_manager'

export default function LoginPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [userEmail, setUserEmail] = React.useState('')
  const [userPassword, setUserPassword] = React.useState('')
  const [teamManagerEmail, setTeamManagerEmail] = React.useState('')
  const [teamManagerPassword, setTeamManagerPassword] = React.useState('')
  const [logging, setLogging] = React.useState(false)
  const [showUserPassword, setShowUserPassword] = React.useState(false)
  const [showManagerPassword, setShowManagerPassword] = React.useState(false)
  const navigate = useNavigate()

  React.useEffect(() => {
    try {
      const savedUser = localStorage.getItem(USER_STORAGE_KEY)
      if (savedUser) {
        const { email, password } = JSON.parse(savedUser)
        if (email) setUserEmail(email)
        if (password) setUserPassword(password)
      }
      const savedManager = localStorage.getItem(MANAGER_STORAGE_KEY)
      if (savedManager) {
        const { email, password } = JSON.parse(savedManager)
        if (email) setTeamManagerEmail(email)
        if (password) setTeamManagerPassword(password)
      }
    } catch {
      // ignore
    }
  }, [])

  const handleUserLogin = async () => {
    if (userEmail.trim() === '' || userPassword.trim() === '') {
      toast.error('请输入账号和密码')
      return
    }

    setLogging(true)

    const token = await captchaChallenge();
    if (token) {
      await apiRequest('v1UsersPasswordLoginCreate', {
        email: userEmail.trim(),
        password: userPassword.trim(),
        captcha_token: token,
      }, [], (resp) => {
        if (resp.code === 0) {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ email: userEmail.trim(), password: userPassword.trim() }))
          navigate('/console/')
        } else {
          toast.error('登录失败，请重试')
        }
      })
    } else {
      toast.error('验证码验证失败')
    }
    setLogging(false)
  }

  const handleTeamManagerLogin = async () => {
    if (teamManagerEmail.trim() === '' || teamManagerPassword.trim() === '') {
      toast.error('请输入账号和密码')
      return
    }

    setLogging(true)

    const token = await captchaChallenge();
    if (token) {

      await apiRequest('v1TeamsUsersLoginCreate', {
        email: teamManagerEmail.trim(),
        password: teamManagerPassword.trim(),
        captcha_token: token,
      }, [], (resp) => {
        if (resp.code === 0) {
          localStorage.setItem(MANAGER_STORAGE_KEY, JSON.stringify({ email: teamManagerEmail.trim(), password: teamManagerPassword.trim() }))
          navigate('/manager/')
        } else {
          toast.error('登录失败，请重试')
        }
      })
    } else {
      toast.error('验证码验证失败')
    }
    setLogging(false)

  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className={cn("flex flex-col gap-6", className)} {...props}>
          <Link to="/">
            <h1 className="text-2xl hover:font-bold">MonkeyCode 智能开发平台</h1>
          </Link>
          <Card>
            <CardContent>
              <Tabs defaultValue="user">
                <TabsList>
                  <TabsTrigger value="user">普通用户</TabsTrigger>
                  <TabsTrigger value="manager">团队管理员</TabsTrigger>
                </TabsList>

                <TabsContent value="user" className="mt-4">
                  <form onSubmit={(e) => { e.preventDefault(); handleUserLogin(); }}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="user-email">账号</FieldLabel>
                        <Input
                          value={userEmail}
                          placeholder="monkeycode@example.com"
                          onChange={(e) => setUserEmail(e.target.value)}
                          id="user-email"
                          type="email"
                          required
                          disabled={logging}
                        />
                      </Field>
                      <Field>
                        <div className="flex flex-row items-center justify-between">
                          <FieldLabel htmlFor="user-password">密码</FieldLabel>
                          <Link to="/findpassword" tabIndex={-1} className="text-sm text-muted-foreground hover:underline">
                            找回密码
                          </Link>
                        </div>
                        <div className="relative">
                          <Input
                            value={userPassword}
                            placeholder="************"
                            onChange={(e) => setUserPassword(e.target.value)}
                            id="user-password"
                            type={showUserPassword ? "text" : "password"}
                            required
                            disabled={logging}
                            className="pr-9"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowUserPassword(v => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </Field>
                      <Field>
                        <Button type="submit" disabled={logging} variant="outline">
                        {logging && <Spinner className="mr-2" />}
                        登录
                      </Button>
                    </Field>
                    <FieldSeparator>其他方式</FieldSeparator>
                    <div className="flex flex-col gap-4">
                      <Button asChild>
                        <a href={"/api/v1/users/login?redirect=&inviter_id=" + (localStorage.getItem('ic') || '')}>百智云账号登录</a>
                      </Button>
                      <Button variant="secondary" asChild>
                        <a href={"/api/v1/users/login?redirect=&inviter_id=" + (localStorage.getItem('ic') || '')}>注册</a>
                      </Button>
                    </div>
                  </FieldGroup>
                  </form>
                </TabsContent>
                <TabsContent value="manager" className="mt-4">
                  <form onSubmit={(e) => { e.preventDefault(); handleTeamManagerLogin(); }}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="email">账号</FieldLabel>
                        <Input
                          value={teamManagerEmail}
                          placeholder="monkeycode@example.com"
                          onChange={(e) => setTeamManagerEmail(e.target.value)}
                          id="email"
                          type="email"
                          required
                          disabled={logging}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="password">密码</FieldLabel>
                        <div className="relative">
                          <Input
                            id="password"
                            placeholder="************"
                            type={showManagerPassword ? "text" : "password"}
                            required
                            disabled={logging}
                            value={teamManagerPassword}
                            onChange={(e) => setTeamManagerPassword(e.target.value)}
                            className="pr-9"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowManagerPassword(v => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showManagerPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </Field>
                      <Field>
                        <Button type="submit" disabled={logging}>
                        {logging && <Spinner />}
                        登录
                      </Button>
                    </Field>
                  </FieldGroup>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

  )
}
