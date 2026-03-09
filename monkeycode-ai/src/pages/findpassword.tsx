import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Field } from "@/components/ui/field";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { captchaChallenge, isValidEmail } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";


export default function FindPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleFindPassword = async () => {
    if (!isValidEmail(email)) {
      toast.error('请输入正确的邮箱地址');
      return;
    }
    
    setLoading(true);

    const token = await captchaChallenge();
    if (token) {
      await apiRequest('v1UsersPasswordsResetRequestUpdate', { 
        emails: [email],
        captcha_token: token
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success('重置密码邮件已发送，请注意查收');
        } else {
          toast.error(resp.message || '重置密码邮件发送失败');
        }
      });
    } else {
      toast.error('验证码验证失败');
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Link to="/">
            <h1 className="text-2xl hover:font-bold">MonkeyCode 智能开发平台</h1>
          </Link>
          <Card>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field>
                  <Button onClick={handleFindPassword} disabled={loading || !email}>
                    {loading && <Spinner />}
                    找回密码
                  </Button>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
